"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import { useRef, useState } from "react";
import type { Mesh, MeshPhysicalMaterial } from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";

const POOL = 26;
const ROUND = 45;
type Kind = "bubble" | "gold" | "bomb";
interface B { x: number; y: number; z: number; v: number; r: number; kind: Kind; alive: boolean; pop: number; phase: number }
interface State { bubbles: B[]; spawn: number; score: number; combo: number; lastPop: number; time: number; lives: number; t: number }
const fresh = (): State => ({ bubbles: [], spawn: 0, score: 0, combo: 0, lastPop: -9, time: ROUND, lives: 3, t: 0 });
const COLORS: Record<Kind, string> = { bubble: "#9fd8ff", gold: "#ffd23f", bomb: "#ff3b5c" };

function Bubbles({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const meshes = useRef<(Mesh | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  useFrame((_, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    if (phase === "play") {
      s.time -= dt;
      if (s.time <= 0) { s.time = 0; onEnd(); }
      s.spawn -= dt;
      if (s.spawn <= 0 && s.bubbles.filter((b) => b.alive).length < POOL - 2) {
        s.spawn = Math.max(0.18, 0.55 - (ROUND - s.time) * 0.008);
        const r = Math.random();
        const kind: Kind = r < 0.1 ? "gold" : r < 0.24 ? "bomb" : "bubble";
        const slot = s.bubbles.findIndex((b) => !b.alive && b.pop <= 0);
        const nb: B = { x: (Math.random() - 0.5) * 9, y: -4.5, z: (Math.random() - 0.5) * 3, v: 1.1 + Math.random() * 1.4 + (ROUND - s.time) * 0.03,
          r: kind === "gold" ? 0.38 : 0.45 + Math.random() * 0.35, kind, alive: true, pop: 0, phase: Math.random() * 6 };
        if (slot >= 0) s.bubbles[slot] = nb; else if (s.bubbles.length < POOL) s.bubbles.push(nb);
      }
    }
    for (const b of s.bubbles) {
      if (b.alive) { b.y += b.v * dt; b.x += Math.sin(s.t * 1.5 + b.phase) * dt * 0.4; if (b.y > 4.8) b.alive = false; }
      else if (b.pop > 0) b.pop -= dt * 3;
    }
    meshes.current.forEach((m, i) => {
      if (!m) return;
      const b = s.bubbles[i];
      m.visible = !!b && (b.alive || b.pop > 0);
      if (!b) return;
      m.position.set(b.x, b.y, b.z);
      const sc = b.alive ? b.r * (1 + Math.sin(s.t * 4 + b.phase) * 0.04) : b.r * (1 + (1 - b.pop) * 1.2);
      m.scale.setScalar(sc);
      const mat = m.material as MeshPhysicalMaterial;
      mat.color.set(COLORS[b.kind]);
      mat.opacity = b.alive ? (b.kind === "bubble" ? 0.55 : 0.9) : Math.max(0, b.pop) * 0.6;
    });
    hud.current += dt;
    if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
  });
  const hit = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const s = st.current;
    const b = s.bubbles[i];
    if (phase !== "play" || !b?.alive) return;
    b.alive = false; b.pop = 1;
    burst(b.x, b.y, b.z, COLORS[b.kind], b.kind === "bubble" ? 16 : 40);
    if (b.kind === "bomb") { s.lives -= 1; s.combo = 0; sfx("hit"); if (s.lives <= 0) onEnd(); return; }
    sfx(b.kind === "gold" ? "coin" : "pop", Math.min(1, s.combo / 10));
    s.combo = s.t - s.lastPop < 0.8 ? s.combo + 1 : 1;
    s.lastPop = s.t;
    s.score += (b.kind === "gold" ? 5 : 1) * Math.min(4, Math.ceil(s.combo / 3));
  };
  return (
    <>
      <color attach="background" args={["#160f2e"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[4, 6, 5]} intensity={2} />
      <pointLight position={[-4, 2, 4]} intensity={30} color="#ff9ecf" />
      <pointLight position={[4, -2, 3]} intensity={30} color="#4fe3ff" />
      <Float speed={1} floatIntensity={0.6}>
        <mesh position={[0, 0, -6]}><torusKnotGeometry args={[2.2, 0.5, 160, 16]} /><meshStandardMaterial color="#8f7bff" emissive="#3a1f9e" emissiveIntensity={0.5} wireframe /></mesh>
      </Float>
      {sparks}
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={i} ref={(m) => { meshes.current[i] = m; }} visible={false} onPointerDown={hit(i)}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshPhysicalMaterial transparent roughness={0.05} metalness={0.1} clearcoat={1} iridescence={1} iridescenceIOR={1.3} color="#9fd8ff" />
        </mesh>
      ))}
    </>
  );
}

export function BubblePop() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, lives: 3, time: ROUND, combo: 0 });
  const [best, setBest] = usePersistent("best3dBubbles", 0);
  const start = () => { st.current = fresh(); setHud({ score: 0, lives: 3, time: ROUND, combo: 0 }); setPhase("play"); };
  const end = () => { if (phase !== "play") return; setPhase("over"); setBest((b) => Math.max(b, st.current.score)); };
  return (
    <GameFrame title="Bubble Pop" emoji="🫧" phase={phase} score={hud.score} best={best} lives={hud.lives} onStart={start}
      extra={<>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">⏱ {Math.ceil(hud.time)}s</span>
        {hud.combo >= 3 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">x{Math.min(4, Math.ceil(hud.combo / 3))} combo</span>}
      </>}
      how={<>Pop the floating bubbles before they drift away. Gold = 5 points, quick pops build a combo. Don&apos;t touch the red bombs! {ROUND} seconds.</>}>
      <div className="absolute inset-0 cursor-pointer">
        <Canvas camera={{ position: [0, 0, 8], fov: 60 }} dpr={[1, 1.75]}>
          <Bubbles st={st} phase={phase} onHud={(s) => setHud({ score: s.score, lives: s.lives, time: s.time, combo: s.combo })} onEnd={end} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
