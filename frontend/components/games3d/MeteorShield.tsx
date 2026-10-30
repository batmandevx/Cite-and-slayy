"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop) */

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles, Stars } from "@react-three/drei";
import { useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Glow, useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";

const POOL = 18, R_SHIELD = 2.6, R_PLANET = 1.25, ARC = 0.62;
interface Rock { a: number; r: number; v: number; gold: boolean; alive: boolean; spin: number }
interface State { aim: number; shield: number; rocks: Rock[]; spawn: number; score: number; lives: number; t: number; shake: number; streak: number }
const fresh = (): State => ({ aim: 0, shield: 0, rocks: [], spawn: 1, score: 0, lives: 3, t: 0, shake: 0, streak: 0 });

function Space({ st, phase, onHud, onDie }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onDie: () => void }) {
  const planet = useRef<Mesh>(null), clouds = useRef<Mesh>(null), shield = useRef<Group>(null), ring = useRef<Mesh>(null);
  const rocks = useRef<(Group | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  useFrame((state, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    s.aim = phase === "play" ? Math.atan2(state.pointer.y * 0.75, state.pointer.x) : s.t * 0.8;
    let d = s.aim - s.shield;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.shield += d * Math.min(1, dt * 14);
    if (phase === "play") {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.42, 1.25 - s.score * 0.012);
        s.rocks.push({ a: Math.random() * Math.PI * 2, r: 11, v: 2.2 + Math.random() * 1.2 + s.score * 0.03, gold: Math.random() < 0.14, alive: true, spin: Math.random() * 6 });
      }
      for (const k of s.rocks) {
        if (!k.alive) continue;
        k.r -= k.v * dt; k.spin += dt * 3;
        const x = Math.cos(k.a) * k.r, y = Math.sin(k.a) * k.r;
        if (k.r <= R_SHIELD + 0.25 && k.r > R_SHIELD - 0.4) {
          let off = k.a - s.shield; off = Math.atan2(Math.sin(off), Math.cos(off));
          if (Math.abs(off) < ARC) {
            k.alive = false; s.streak += 1; s.score += k.gold ? 5 : 1;
            burst(x, y, 0, k.gold ? "#ffd23f" : "#4fe3ff", k.gold ? 44 : 22);
            sfx(s.streak % 8 === 0 ? "combo" : k.gold ? "coin" : "pop", Math.min(1, s.streak / 16));
            continue;
          }
        }
        if (k.r <= R_PLANET + 0.2) {
          k.alive = false; s.lives -= 1; s.streak = 0; s.shake = 0.5;
          burst(x, y, 0, "#ff4fa3", 60); sfx("hit");
          if (s.lives <= 0) onDie();
        }
      }
      s.rocks = s.rocks.filter((k) => k.alive).slice(-POOL);
      hud.current += dt;
      if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
    }
    s.shake = Math.max(0, s.shake - dt);
    state.camera.position.x = (Math.random() - 0.5) * s.shake;
    state.camera.position.y = -1.6 + (Math.random() - 0.5) * s.shake;
    state.camera.lookAt(0, 0, 0);
    if (planet.current) planet.current.rotation.y += dt * 0.25;
    if (clouds.current) clouds.current.rotation.y += dt * 0.4;
    if (ring.current) ring.current.rotation.z += dt * 0.15;
    if (shield.current) shield.current.rotation.z = s.shield;
    rocks.current.forEach((g, i) => {
      if (!g) return;
      const k = s.rocks[i];
      g.visible = !!k;
      if (!k) return;
      g.position.set(Math.cos(k.a) * k.r, Math.sin(k.a) * k.r, 0);
      g.rotation.set(k.spin, k.spin * 0.7, 0);
      g.children.forEach((c, j) => { c.visible = (j === 0) !== k.gold || j === 2; });
    });
  });
  return (
    <>
      <color attach="background" args={["#07051a"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[-4, 3, 5]} intensity={2.2} color="#fff1d6" />
      <Stars radius={60} depth={30} count={2500} factor={3} fade speed={0.6} />
      <Sparkles count={80} scale={[22, 14, 4]} size={2.5} speed={0.2} color="#8f7bff" />
      {/* planet */}
      <mesh ref={planet}>
        <icosahedronGeometry args={[R_PLANET, 3]} />
        <meshStandardMaterial color="#2f7bff" emissive="#0b2a7a" emissiveIntensity={0.5} flatShading roughness={0.7} />
        <Glow color="#4fa3ff" size={4.6} opacity={0.45} />
      </mesh>
      <mesh ref={clouds} scale={1.06}>
        <icosahedronGeometry args={[R_PLANET, 2]} />
        <meshStandardMaterial color="#c6f24e" transparent opacity={0.22} flatShading wireframe />
      </mesh>
      <mesh ref={ring} rotation={[1.2, 0.3, 0]}>
        <torusGeometry args={[1.9, 0.04, 8, 80]} />
        <meshBasicMaterial color="#ffd23f" transparent opacity={0.5} />
      </mesh>
      {/* orbit guide + shield */}
      <mesh><torusGeometry args={[R_SHIELD, 0.012, 6, 120]} /><meshBasicMaterial color="#8f7bff" transparent opacity={0.35} /></mesh>
      <group ref={shield}>
        <mesh rotation={[0, 0, -ARC]}>
          <torusGeometry args={[R_SHIELD, 0.13, 12, 48, ARC * 2]} />
          <meshStandardMaterial color="#ff4fa3" emissive="#ff4fa3" emissiveIntensity={1.4} metalness={0.3} roughness={0.2} />
        </mesh>
        <group position={[R_SHIELD, 0, 0]}><Glow color="#ff4fa3" size={2.6} opacity={0.7} /></group>
      </group>
      {/* meteors */}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { rocks.current[i] = g; }} visible={false}>
          <mesh><dodecahedronGeometry args={[0.32, 0]} /><meshStandardMaterial color="#9b8c7a" flatShading roughness={0.9} /></mesh>
          <mesh><octahedronGeometry args={[0.34, 0]} /><meshStandardMaterial color="#ffd23f" emissive="#c79a00" emissiveIntensity={1} flatShading /></mesh>
          <Glow color="#ff8a3d" size={1.4} opacity={0.6} />
        </group>
      ))}
      {sparks}
    </>
  );
}

export function MeteorShield() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, lives: 3, streak: 0 });
  const [best, setBest] = usePersistent("best3dMeteor", 0);
  const start = () => { st.current = fresh(); setHud({ score: 0, lives: 3, streak: 0 }); setPhase("play"); };
  return (
    <GameFrame title="Meteor Shield" emoji="☄️" phase={phase} score={hud.score} best={best} lives={hud.lives} onStart={start}
      extra={hud.streak >= 8 ? <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">🔥 {hud.streak} streak</span> : null}
      how={<>Move the mouse around the planet to swing your shield. Deflect meteors before they hit; gold ones are worth 5. Three hits and the planet falls.</>}>
      <div className="absolute inset-0 cursor-crosshair touch-none">
        <Canvas camera={{ position: [0, -1.6, 10], fov: 55 }} dpr={[1, 1.75]}>
          <Space st={st} phase={phase} onHud={(s) => setHud({ score: s.score, lives: s.lives, streak: s.streak })}
            onDie={() => { setPhase("over"); setBest((b) => Math.max(b, st.current.score)); setHud((h) => ({ ...h, lives: 0, score: st.current.score })); }} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
