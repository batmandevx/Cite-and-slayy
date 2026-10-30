"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Glow, useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";

const LANES = [-2.2, 0, 2.2];
const POOL = 28;
interface Thing { z: number; lane: number; kind: "block" | "low" | "gem"; alive: boolean }

interface State { lane: number; x: number; y: number; vy: number; speed: number; dist: number; gems: number; spawn: number; things: Thing[]; dead: boolean; shake: number }
const fresh = (): State => ({ lane: 1, x: 0, y: 0.5, vy: 0, speed: 14, dist: 0, gems: 0, spawn: 0, things: [], dead: false, shake: 0 });

function World({ st, phase, onScore, onDie }: { st: React.RefObject<State>; phase: Phase; onScore: (s: number) => void; onDie: () => void }) {
  const player = useRef<Mesh>(null);
  const meshes = useRef<(Group | null)[]>([]);
  const grid = useRef<Group>(null);
  const tick = useRef(0);
  const [sparks, burst] = useSparks();
  useFrame((state, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    if (phase === "play" && !s.dead) {
      s.speed += dt * 0.35;
      s.dist += s.speed * dt;
      s.x += (LANES[s.lane] - s.x) * Math.min(1, dt * 14);
      s.vy -= 30 * dt; s.y = Math.max(0.5, s.y + s.vy * dt); if (s.y === 0.5) s.vy = 0;
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.35, 1.1 - s.speed * 0.02);
        const lane = Math.floor(Math.random() * 3);
        const r = Math.random();
        s.things.push({ z: -60, lane, kind: r < 0.3 ? "gem" : r < 0.55 ? "low" : "block", alive: true });
        if (Math.random() < 0.3) s.things.push({ z: -60, lane: (lane + 1 + Math.floor(Math.random() * 2)) % 3, kind: "block", alive: true });
      }
      for (const t of s.things) {
        t.z += s.speed * dt;
        if (t.alive && Math.abs(t.z) < 0.8 && Math.abs(LANES[t.lane] - s.x) < 1.1) {
          if (t.kind === "gem") { t.alive = false; s.gems += 1; burst(LANES[t.lane], 1, 0, "#ffd23f", 26); sfx("coin", (s.gems % 6) / 6); }
          else if (t.kind === "block" || s.y < 1.3) { s.dead = true; s.shake = 0.6; burst(s.x, s.y, 0, "#ff4fa3", 70); sfx("hit"); onDie(); }
        }
      }
      s.things = s.things.filter((t) => t.z < 8).slice(-POOL);
      tick.current += dt;
      if (tick.current > 0.1) { tick.current = 0; onScore(Math.floor(s.dist / 4) + s.gems * 10); }
    }
    if (player.current) {
      player.current.position.set(s.x, s.y, 0);
      player.current.rotation.x -= dt * s.speed * 0.6;
    }
    if (grid.current) grid.current.position.z = (s.dist % 4);
    s.shake = Math.max(0, s.shake - dt * 1.2);
    state.camera.position.x = s.x * 0.35 + (Math.random() - 0.5) * s.shake;
    state.camera.position.y = 3.2 + (Math.random() - 0.5) * s.shake;
    state.camera.lookAt(s.x * 0.5, 0.8, -8);
    meshes.current.forEach((g, i) => {
      if (!g) return;
      const t = s.things[i];
      g.visible = !!t && t.alive;
      if (!t) return;
      g.position.set(LANES[t.lane], t.kind === "low" ? 0.35 : t.kind === "gem" ? 1 + Math.sin(t.z) * 0.2 : 0.9, t.z);
      g.rotation.y += t.kind === "gem" ? dt * 3 : 0;
      g.children.forEach((c, k) => { c.visible = (k === 0 && t.kind === "block") || (k === 1 && t.kind === "low") || (k === 2 && t.kind === "gem"); });
    });
  });
  return (
    <>
      <color attach="background" args={["#120d1f"]} />
      <fog attach="fog" args={["#120d1f", 25, 85]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 6, 4]} intensity={60} color="#ff9ecf" />
      <directionalLight position={[3, 8, 5]} intensity={1.2} />
      <Stars radius={90} depth={40} count={1500} factor={3} fade speed={1} />
      <group ref={grid}>
        {Array.from({ length: 30 }, (_, i) => (
          <mesh key={i} position={[0, 0, -i * 4]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[8, 0.06]} />
            <meshBasicMaterial color="#ff4fa3" />
          </mesh>
        ))}
        {[-3.3, -1.1, 1.1, 3.3].map((x) => (
          <mesh key={x} position={[x, 0.01, -55]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.05, 130]} />
            <meshBasicMaterial color="#8f7bff" />
          </mesh>
        ))}
      </group>
      <mesh position={[0, -0.01, -50]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 140]} />
        <meshStandardMaterial color="#1d1433" />
      </mesh>
      <mesh ref={player} castShadow>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshStandardMaterial color="#c6f24e" emissive="#7fb800" emissiveIntensity={0.6} flatShading />
        <Glow color="#c6f24e" size={2.6} opacity={0.7} />
      </mesh>
      {sparks}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { meshes.current[i] = g; }} visible={false}>
          <mesh><boxGeometry args={[1.6, 1.8, 1]} /><meshStandardMaterial color="#ff4fa3" emissive="#a0004f" emissiveIntensity={0.5} /></mesh>
          <mesh><boxGeometry args={[1.8, 0.7, 0.6]} /><meshStandardMaterial color="#4f7dff" emissive="#1c3cb8" emissiveIntensity={0.6} /></mesh>
          <mesh><octahedronGeometry args={[0.45]} /><meshStandardMaterial color="#ffd23f" emissive="#c79a00" emissiveIntensity={0.9} /><Glow color="#ffd23f" size={2} opacity={0.6} /></mesh>
        </group>
      ))}
    </>
  );
}

export function NeonRunner() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = usePersistent("best3dRunner", 0);
  const start = () => { st.current = fresh(); setScore(0); setPhase("play"); };
  const left = () => { if (st.current.lane > 0) { st.current.lane -= 1; sfx("flip"); } };
  const right = () => { if (st.current.lane < 2) { st.current.lane += 1; sfx("flip"); } };
  const jump = () => { if (st.current.y <= 0.51) { st.current.vy = 10.5; sfx("whoosh"); } };
  useEffect(() => {
    if (phase !== "play") return;
    const k = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) left();
      else if (["ArrowRight", "d", "D"].includes(e.key)) right();
      else if (["ArrowUp", " ", "w", "W"].includes(e.key)) jump();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [phase]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  return (
    <GameFrame title="Neon Runner" emoji="🏃" phase={phase} score={score} best={best} onStart={start}
      how={<>Dodge pink walls, jump the blue bars, grab gold gems. <b>← →</b> switch lanes, <b>↑ / Space</b> jump. On touch: swipe.</>}>
      <div className="absolute inset-0"
        onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          if (!touch.current || phase !== "play") return;
          const dx = e.clientX - touch.current.x, dy = e.clientY - touch.current.y;
          if (Math.abs(dy) > Math.abs(dx) && dy < -20) jump(); else if (dx > 20) right(); else if (dx < -20) left(); else jump();
          touch.current = null;
        }}>
        <Canvas camera={{ position: [0, 3.2, 7], fov: 60 }} dpr={[1, 1.75]}>
          <World st={st} phase={phase} onScore={setScore} onDie={() => { setPhase("over"); setBest((b) => Math.max(b, Math.floor(st.current.dist / 4) + st.current.gems * 10)); }} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
