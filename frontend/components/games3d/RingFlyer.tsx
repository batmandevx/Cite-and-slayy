"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useRef, useState } from "react";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Glow, useSparks } from "./fx";
import { Crystals, Jet, SynthSun, useContrail, WarpStreaks } from "./models";
import { GameFrame, type Phase } from "./GameFrame";

const POOL = 10;
interface Ring { x: number; y: number; z: number; r: number; done: boolean; gold: boolean }
interface State { px: number; py: number; tx: number; ty: number; speed: number; rings: Ring[]; spawn: number; score: number; combo: number; lives: number; t: number }
const fresh = (): State => ({ px: 0, py: 0, tx: 0, ty: 0, speed: 20, rings: [], spawn: 0.5, score: 0, combo: 0, lives: 3, t: 0 });

function Sky({ st, phase, onHud, onDie }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onDie: () => void }) {
  const plane = useRef<Group>(null);
  const rings = useRef<(Mesh | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const jet = useRef<Group>(null);
  const speed = useRef(20);
  const [contrail, stepTrail] = useContrail([[1.33, 0.02, 0.62], [-1.33, 0.02, 0.62]]);
  useFrame((state, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    if (phase === "play") {
      s.tx = state.pointer.x * 5; s.ty = state.pointer.y * 3;
      s.speed += dt * 0.4;
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.55, 1.3 - s.speed * 0.015);
        const last = s.rings.at(-1);
        const nx = Math.max(-4.5, Math.min(4.5, (last?.x ?? 0) + (Math.random() - 0.5) * 5));
        const ny = Math.max(-2.6, Math.min(2.6, (last?.y ?? 0) + (Math.random() - 0.5) * 3));
        s.rings.push({ x: nx, y: ny, z: -70, r: Math.max(0.9, 1.5 - s.score * 0.01), done: false, gold: Math.random() < 0.15 });
      }
      for (const r of s.rings) {
        const prev = r.z;
        r.z += s.speed * dt;
        if (!r.done && prev < 0 && r.z >= 0) {
          r.done = true;
          if (Math.hypot(r.x - s.px, r.y - s.py) < r.r) {
            s.combo += 1; s.score += (r.gold ? 5 : 1) * Math.min(5, 1 + Math.floor(s.combo / 5));
            burst(r.x, r.y, 0, r.gold ? "#ffd23f" : "#4fe3ff", r.gold ? 50 : 28);
            sfx(s.combo % 5 === 0 ? "combo" : "coin", Math.min(1, s.combo / 12));
          } else { s.combo = 0; s.lives -= 1; burst(s.px, s.py, 0, "#ff4fa3", 30); sfx("hit"); if (s.lives <= 0) onDie(); }
        }
      }
      s.rings = s.rings.filter((r) => r.z < 10).slice(-POOL);
      hud.current += dt;
      if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
    } else {
      s.tx = Math.sin(s.t) * 2; s.ty = Math.cos(s.t * 0.7);
    }
    s.px += (s.tx - s.px) * Math.min(1, dt * 6);
    s.py += (s.ty - s.py) * Math.min(1, dt * 6);
    speed.current = s.speed;
    if (plane.current) {
      plane.current.position.set(s.px, s.py + Math.sin(s.t * 2.2) * 0.05, 0);
      plane.current.rotation.z = -(s.tx - s.px) * 0.55 + Math.sin(s.t * 1.3) * 0.03;
      plane.current.rotation.x = (s.ty - s.py) * 0.35;
      plane.current.rotation.y = -(s.tx - s.px) * 0.12;
    }
    stepTrail(jet.current, s.speed, dt);
    rings.current.forEach((m, i) => {
      if (!m) return;
      const r = s.rings[i];
      m.visible = !!r;
      if (!r) return;
      m.position.set(r.x, r.y, r.z);
      m.scale.setScalar(r.r);
      m.rotation.z += dt;
      const mat = m.material as MeshStandardMaterial;
      mat.color.set(r.done ? "#555577" : r.gold ? "#ffd23f" : "#4fe3ff");
      mat.emissive.set(r.done ? "#000000" : r.gold ? "#a07800" : "#007a99");
    });
    state.camera.position.x += (s.px * 0.4 - state.camera.position.x) * 0.05;
    state.camera.position.y += (s.py * 0.4 + 1 - state.camera.position.y) * 0.05;
    state.camera.lookAt(s.px * 0.5, s.py * 0.5, -20);
  });
  return (
    <>
      <color attach="background" args={["#0d0b24"]} />
      <fog attach="fog" args={["#0d0b24", 30, 110]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 5, 4]} intensity={1.5} />
      <Stars radius={120} depth={60} count={3000} factor={4} fade speed={2} />
      <group ref={plane}>
        <Jet ref={jet} />
        <pointLight position={[0, 0.6, 1.4]} intensity={10} color="#ff9ecf" distance={5} />
      </group>
      {contrail}
      {sparks}
      <WarpStreaks speedRef={speed} />
      <Crystals speedRef={speed} />
      <mesh position={[0, -9, -40]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[220, 220, 44, 44]} />
        <meshBasicMaterial color="#8f7bff" wireframe transparent opacity={0.18} />
      </mesh>
      <SynthSun position={[0, 4, -100]} size={26} />
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={i} ref={(m) => { rings.current[i] = m; }} visible={false}>
          <torusGeometry args={[1, 0.09, 16, 64]} />
          <meshStandardMaterial color="#4fe3ff" emissive="#007a99" emissiveIntensity={1.3} metalness={0.4} roughness={0.2} />
          <Glow color="#4fe3ff" size={3.2} opacity={0.35} />
        </mesh>
      ))}
    </>
  );
}

export function RingFlyer() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, lives: 3, combo: 0 });
  const [best, setBest] = usePersistent("best3dRings", 0);
  const start = () => { st.current = fresh(); setHud({ score: 0, lives: 3, combo: 0 }); setPhase("play"); };
  return (
    <GameFrame title="Ring Flyer" emoji="✈️" phase={phase} score={hud.score} best={best} lives={hud.lives} onStart={start}
      extra={hud.combo >= 5 ? <span className="rounded-xl border-2 border-white/30 bg-[#ff4fa3]/80 px-2 py-1 text-sm font-extrabold">x{Math.min(5, 1 + Math.floor(hud.combo / 5))} combo</span> : null}
      how={<>Steer your jet with the mouse (or drag on touch) through the glowing rings. Gold rings are worth 5. Miss three and you crash.</>}>
      <div className="absolute inset-0 cursor-crosshair touch-none">
        <Canvas camera={{ position: [0, 1.2, 6], fov: 62 }} dpr={[1, 1.75]}>
          <Sky st={st} phase={phase} onHud={(s) => setHud({ score: s.score, lives: s.lives, combo: s.combo })}
            onDie={() => { setPhase("over"); setBest((b) => Math.max(b, st.current.score)); setHud((h) => ({ ...h, lives: 0, score: st.current.score })); }} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
