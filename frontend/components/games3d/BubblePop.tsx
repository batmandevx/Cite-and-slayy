"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";
import { hash, sandTexture, useTex } from "./scenery";

const POOL = 28;
const ROUND = 45;
type Kind = "bubble" | "gold" | "mine" | "clock" | "ice";
interface B { x: number; y: number; z: number; v: number; r: number; kind: Kind; alive: boolean; pop: number; phase: number }
interface State { bubbles: B[]; spawn: number; score: number; combo: number; lastPop: number; time: number; lives: number; t: number; slow: number; flash: number }
const fresh = (): State => ({ bubbles: [], spawn: 0, score: 0, combo: 0, lastPop: -9, time: ROUND, lives: 3, t: 0, slow: 0, flash: 0 });
const COLORS: Record<Kind, string> = { bubble: "#9fd8ff", gold: "#ffd23f", mine: "#ff3b5c", clock: "#7ee8c8", ice: "#bfe8ff" };

// ---------------------------------------------------------------- the lagoon

function Seaweed({ x, z, h, seed }: { x: number; z: number; h: number; seed: number }) {
  const segs = useRef<(THREE.Object3D | null)[]>([]);
  useFrame(({ clock }) => {
    segs.current.forEach((s, i) => { if (s) s.rotation.z = Math.sin(clock.elapsedTime * 1.3 + seed + i * 0.5) * 0.18; });
  });
  const n = 6, len = h / n;
  // nested segments: each one bends relative to the one below, so the strand sways like kelp
  const build = (i: number): React.ReactNode => i >= n ? null : (
    <group ref={(g) => { segs.current[i] = g; }} position={[0, i === 0 ? 0 : len, 0]}>
      <mesh position={[0, len / 2, 0]}><boxGeometry args={[0.24 - i * 0.025, len * 1.05, 0.03]} /><meshStandardMaterial color={i % 2 ? "#2f9e5a" : "#38b36a"} roughness={0.7} /></mesh>
      {build(i + 1)}
    </group>
  );
  return <group position={[x, -4.6, z]} rotation-y={(hash(seed, 8) - 0.5) * 0.9}>{build(0)}</group>;
}

function Coral({ x, z, color, seed }: { x: number; z: number; color: string; seed: number }) {
  return (
    <group position={[x, -4.6, z]} rotation-y={seed}>
      {Array.from({ length: 5 }, (_, i) => {
        const a = hash(i, seed) * Math.PI * 2, tilt = 0.2 + hash(i, seed + 1) * 0.5, h = 0.5 + hash(i, seed + 2) * 0.7;
        return (
          <group key={i} rotation={[Math.cos(a) * tilt, 0, Math.sin(a) * tilt]}>
            <mesh position={[0, h / 2, 0]}><cylinderGeometry args={[0.05, 0.09, h, 8]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
            <mesh position={[0, h, 0]}><sphereGeometry args={[0.1, 10, 8]} /><meshStandardMaterial color={color} roughness={0.5} emissive={color} emissiveIntensity={0.15} /></mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.05, 0]} scale={[1, 0.5, 1]}><icosahedronGeometry args={[0.35, 0]} /><meshStandardMaterial color="#8d7f6c" flatShading roughness={1} /></mesh>
    </group>
  );
}

function Fish({ y, z, speed, color, size, seed }: { y: number; z: number; speed: number; color: string; size: number; seed: number }) {
  const g = useRef<THREE.Group>(null), tail = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed + seed * 10;
    const x = ((t % 16) + 16) % 16 - 8;
    if (g.current) { g.current.position.set(speed > 0 ? x : -x, y + Math.sin(t * 2) * 0.15, z); g.current.rotation.y = speed > 0 ? 0 : Math.PI; }
    if (tail.current) tail.current.rotation.y = Math.sin(clock.elapsedTime * 12 + seed) * 0.5;
  });
  return (
    <group ref={g} scale={size}>
      <mesh scale={[1, 0.55, 0.3]}><sphereGeometry args={[0.3, 16, 12]} /><meshStandardMaterial color={color} roughness={0.35} metalness={0.2} /></mesh>
      <mesh ref={tail} position={[-0.3, 0, 0]}><coneGeometry args={[0.14, 0.24, 4]} /><meshStandardMaterial color={color} roughness={0.4} /></mesh>
      <mesh position={[0.2, 0.06, 0.08]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color="#111" /></mesh>
      <mesh position={[0.2, 0.06, -0.08]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial color="#111" /></mesh>
    </group>
  );
}

function LightRays() {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { g.current?.children.forEach((c, i) => { ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.04 * Math.sin(clock.elapsedTime * 0.7 + i * 1.7); }); });
  return (
    <group ref={g}>
      {[-5, -2.4, 0.6, 3.2, 5.8].map((x, i) => (
        <mesh key={i} position={[x, 1.5, -3 - (i % 2)]} rotation-z={0.25}>
          <coneGeometry args={[1.1, 13, 24, 1, true]} />
          <meshBasicMaterial color="#bff0ff" transparent opacity={0.07} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Lagoon() {
  const sand = useTex(sandTexture, 8, 4);
  const floor = useMemo(() => {
    const g = new THREE.PlaneGeometry(30, 14, 60, 28);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i) * 0.6) * 0.15 + Math.cos(p.getZ(i) * 0.9 + p.getX(i) * 0.2) * 0.12);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={floor} position={[0, -4.65, -3]}><meshStandardMaterial map={sand} color="#cbb98f" roughness={1} /></mesh>
      {[[-6, -3, "#ff6f91", 1], [-3.5, -5, "#ffb347", 2], [4.2, -3.4, "#c084fc", 3], [6.5, -5.5, "#ff6f91", 4], [1.2, -6, "#7ee8c8", 5]].map(([x, z, c, s]) => (
        <Coral key={s as number} x={x as number} z={z as number} color={c as string} seed={s as number} />
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <Seaweed key={i} x={-7.5 + i * 1.15 + hash(i, 5) * 0.5} z={-3.5 - hash(i, 6) * 3} h={1.6 + hash(i, 7) * 1.8} seed={i} />
      ))}
      {[[0.9, -4, 0.6, "#ffb347", 1], [-1.2, -5, -0.45, "#4fc3ff", 0.8], [2.6, -6, 0.35, "#ff6f91", 1.2], [-2.8, -4.5, -0.7, "#ffd23f", 0.7], [3.5, -5.5, -0.3, "#7ee8c8", 0.9]].map(([y, z, sp, c, sz], i) => (
        <Fish key={i} y={y as number} z={z as number} speed={sp as number} color={c as string} size={sz as number} seed={i} />
      ))}
      <LightRays />
    </group>
  );
}

// ---------------------------------------------------------------- bubbles

/** What's inside / on each pooled bubble; only the parts for its kind are shown. */
function BubbleBody({ setRef, onDown }: { setRef: (g: THREE.Group | null) => void; onDown: (e: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group ref={setRef} visible={false}>
      {/* 0: soap film */}
      <mesh onPointerDown={onDown}>
        <sphereGeometry args={[1, 40, 32]} />
        <meshPhysicalMaterial transparent roughness={0.03} metalness={0} clearcoat={1} iridescence={1} iridescenceIOR={1.35} iridescenceThicknessRange={[200, 900]}
          color="#cfefff" opacity={0.42} depthWrite={false} />
      </mesh>
      {/* 1: highlight */}
      <mesh position={[-0.38, 0.42, 0.75]}><sphereGeometry args={[0.13, 12, 10]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.85} /></mesh>
      {/* 2: gold coin */}
      <mesh rotation-x={Math.PI / 2} scale={0.55}><cylinderGeometry args={[0.8, 0.8, 0.16, 32]} /><meshStandardMaterial color="#ffd23f" metalness={0.9} roughness={0.2} emissive="#b8860b" emissiveIntensity={0.3} /></mesh>
      {/* 3: sea mine */}
      <group onPointerDown={onDown}>
        <mesh><sphereGeometry args={[0.8, 24, 18]} /><meshStandardMaterial color="#2b2f3a" metalness={0.7} roughness={0.35} /></mesh>
        {Array.from({ length: 14 }, (_, i) => {
          const phi = Math.acos(1 - (2 * (i + 0.5)) / 14), th = Math.PI * (1 + Math.sqrt(5)) * i;
          const d = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
          return (
            <mesh key={i} position={d.clone().multiplyScalar(0.85)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)}>
              <cylinderGeometry args={[0.04, 0.09, 0.32, 8]} /><meshStandardMaterial color="#555b66" metalness={0.8} roughness={0.3} />
            </mesh>
          );
        })}
        <mesh position={[0, 0, 0.78]}><sphereGeometry args={[0.16, 12, 10]} /><meshStandardMaterial color="#ff2b4a" emissive="#ff2b4a" emissiveIntensity={2} /></mesh>
      </group>
      {/* 4: clock icon */}
      <group scale={0.55}>
        <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.8, 0.8, 0.14, 32]} /><meshStandardMaterial color="#7ee8c8" emissive="#2fbf8f" emissiveIntensity={0.6} /></mesh>
        <mesh position={[0, 0.25, 0.09]}><boxGeometry args={[0.08, 0.5, 0.04]} /><meshBasicMaterial color="#123" /></mesh>
        <mesh position={[0.18, 0, 0.09]}><boxGeometry args={[0.36, 0.08, 0.04]} /><meshBasicMaterial color="#123" /></mesh>
      </group>
      {/* 5: ice crystal */}
      <mesh scale={0.6}><octahedronGeometry args={[0.9, 0]} /><meshPhysicalMaterial color="#e6f7ff" transmission={0.6} roughness={0.05} emissive="#7fd3ff" emissiveIntensity={0.5} /></mesh>
    </group>
  );
}

const SHOW: Record<Kind, number[]> = { bubble: [0, 1], gold: [0, 1, 2], mine: [3], clock: [0, 1, 4], ice: [0, 1, 5] };

const Bubbles = memo(function Bubbles({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const fog = useRef<THREE.Fog>(null);
  useFrame(({ camera }, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    s.slow = Math.max(0, s.slow - dt);
    s.flash = Math.max(0, s.flash - dt * 2);
    const pace = s.slow > 0 ? 0.35 : 1;
    if (phase === "play") {
      s.time -= dt;
      if (s.time <= 0) { s.time = 0; onEnd(); }
      s.spawn -= dt * pace;
      if (s.spawn <= 0 && s.bubbles.filter((b) => b.alive).length < POOL - 2) {
        s.spawn = Math.max(0.2, 0.55 - (ROUND - s.time) * 0.008);
        const r = Math.random();
        const kind: Kind = r < 0.09 ? "gold" : r < 0.24 ? "mine" : r < 0.27 ? "clock" : r < 0.3 ? "ice" : "bubble";
        const slot = s.bubbles.findIndex((b) => !b.alive && b.pop <= 0);
        const nb: B = { x: (Math.random() - 0.5) * 10, y: -4.8, z: (Math.random() - 0.5) * 3, v: 1.1 + Math.random() * 1.4 + (ROUND - s.time) * 0.03,
          r: kind === "bubble" ? 0.42 + Math.random() * 0.35 : kind === "mine" ? 0.48 : 0.42, kind, alive: true, pop: 0, phase: Math.random() * 6 };
        if (slot >= 0) s.bubbles[slot] = nb; else if (s.bubbles.length < POOL) s.bubbles.push(nb);
      }
    }
    for (const b of s.bubbles) {
      if (b.alive) {
        b.y += b.v * dt * pace * (b.kind === "mine" ? 0.75 : 1);
        b.x += Math.sin(s.t * 1.5 + b.phase) * dt * 0.45 * pace;
        if (b.y > 5.2) b.alive = false;
      } else if (b.pop > 0) b.pop -= dt * 3.5;
    }
    groups.current.forEach((g, i) => {
      if (!g) return;
      const b = s.bubbles[i];
      g.visible = !!b && (b.alive || b.pop > 0);
      if (!b || !g.visible) return;
      g.position.set(b.x, b.y, b.z);
      const wob = Math.sin(s.t * 5 + b.phase) * 0.05;
      const sc = b.alive ? b.r : b.r * (1 + (1 - b.pop) * 0.9);
      g.scale.set(sc * (1 + wob), sc * (1 - wob), sc);
      g.rotation.y = b.kind === "bubble" ? 0 : s.t * (b.kind === "mine" ? 0.6 : 1.8) + b.phase;
      g.children.forEach((c, j) => { c.visible = SHOW[b.kind].includes(j) && (b.alive || j === 0); });
      const film = (g.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
      film.opacity = b.alive ? 0.42 : Math.max(0, b.pop) * 0.4;
      film.color.set(b.kind === "ice" ? "#dff4ff" : b.kind === "clock" ? "#d8fff2" : "#cfefff");
      const light = (g.children[3] as THREE.Group).children.at(-1) as THREE.Mesh;
      ((light.material) as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.max(0, Math.sin(s.t * 8 + b.phase)) * 3;
    });
    // a red flash tints the water after hitting a mine; the ice power-up gives it a cold blue cast
    if (fog.current) fog.current.color.setRGB(0.03 + s.flash * 0.5, 0.18 + (s.slow > 0 ? 0.1 : 0) - s.flash * 0.1, 0.32 + (s.slow > 0 ? 0.2 : 0));
    camera.position.x = Math.sin(s.t * 0.25) * 0.3 + (s.flash > 0.6 ? (Math.random() - 0.5) * 0.25 : 0);
    hud.current += dt;
    if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
  });
  const hit = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const s = st.current;
    const b = s.bubbles[i];
    if (phase !== "play" || !b?.alive) return;
    b.alive = false; b.pop = 1;
    burst(b.x, b.y, b.z, COLORS[b.kind], b.kind === "bubble" ? 18 : 48);
    if (b.kind === "mine") { s.lives -= 1; s.combo = 0; s.flash = 1; sfx("hit"); if (s.lives <= 0) onEnd(); return; }
    if (b.kind === "clock") { s.time += 5; sfx("chime"); }
    else if (b.kind === "ice") { s.slow = 4; sfx("chime"); }
    else sfx(b.kind === "gold" ? "coin" : "pop", Math.min(1, s.combo / 10));
    s.combo = s.t - s.lastPop < 0.8 ? s.combo + 1 : 1;
    s.lastPop = s.t;
    s.score += (b.kind === "gold" ? 5 : 1) * Math.min(4, Math.ceil(s.combo / 3));
  };
  return (
    <>
      <color attach="background" args={["#063a5c"]} />
      <fog ref={fog} attach="fog" args={["#08304d", 6, 22]} />
      <hemisphereLight args={["#bff0ff", "#0b2a3a", 0.9]} />
      <directionalLight position={[2, 10, 4]} intensity={2.2} color="#e8fbff" />
      <pointLight position={[-4, 2, 4]} intensity={18} color="#ff9ecf" />
      <pointLight position={[4, -2, 3]} intensity={18} color="#4fe3ff" />
      <Lagoon />
      <Sparkles count={140} scale={[16, 10, 6]} size={2.5} speed={0.6} color="#dff6ff" noise={0.4} />
      {sparks}
      {Array.from({ length: POOL }, (_, i) => <BubbleBody key={i} setRef={(g) => { groups.current[i] = g; }} onDown={hit(i)} />)}
    </>
  );
});

export function BubblePop() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, lives: 3, time: ROUND, combo: 0, slow: 0 });
  const [best, setBest] = usePersistent("best3dBubbles", 0);
  const playing = useRef(false);
  const start = () => { st.current = fresh(); playing.current = true; setHud({ score: 0, lives: 3, time: ROUND, combo: 0, slow: 0 }); setPhase("play"); };
  const end = useCallback(() => {
    if (!playing.current) return;
    playing.current = false; setPhase("over"); setBest((b) => Math.max(b, st.current.score));
  }, [setBest]);
  const onHud = useCallback((s: State) => setHud({ score: s.score, lives: s.lives, time: s.time, combo: s.combo, slow: s.slow }), []);
  const chip = "rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur";
  return (
    <GameFrame title="Bubble Pop" emoji="🫧" phase={phase} score={hud.score} best={best} lives={hud.lives} onStart={start}
      extra={<>
        <span className={chip}>⏱ {Math.ceil(hud.time)}s</span>
        {hud.combo >= 3 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">x{Math.min(4, Math.ceil(hud.combo / 3))} combo</span>}
        {hud.slow > 0 && <span className="rounded-xl border-2 border-white/30 bg-[#bfe8ff] px-2 py-1 text-sm font-extrabold text-[#121212]">❄️ slow-mo {Math.ceil(hud.slow)}s</span>}
      </>}
      how={<>Pop the bubbles drifting up through the lagoon. Gold bubbles hold coins (5 points), quick pops build a combo, the clock adds 5 seconds and the ice crystal slows everything down. Never touch the spiky sea mines! {ROUND} seconds.</>}>
      <div className="absolute inset-0 cursor-pointer">
        <Canvas camera={{ position: [0, 0, 8], fov: 60 }} dpr={[1, 1.75]}>
          <Bubbles st={st} phase={phase} onHud={onHud} onEnd={end} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
