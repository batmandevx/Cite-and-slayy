"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop) */

import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles, Stars } from "@react-three/drei";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Glow, useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";
import { hash } from "./scenery";

const POOL = 18, R_SHIELD = 2.6, R_PLANET = 1.25, ARC = 0.62;
type Kind = "rock" | "gold" | "heart" | "wide";
interface Rock { a: number; r: number; v: number; kind: Kind; alive: boolean; spin: number }
interface State { aim: number; shield: number; rocks: Rock[]; spawn: number; score: number; lives: number; t: number; shake: number; streak: number; wide: number; hurt: number }
const fresh = (): State => ({ aim: 0, shield: 0, rocks: [], spawn: 1, score: 0, lives: 3, t: 0, shake: 0, streak: 0, wide: 0, hurt: 0 });
const BURST: Record<Kind, string> = { rock: "#4fe3ff", gold: "#ffd23f", heart: "#ff6fa8", wide: "#c6f24e" };

// ---------------------------------------------------------------- planet textures (drawn once)

let earthTex: THREE.CanvasTexture | null = null, cloudTex: THREE.CanvasTexture | null = null, moonTex: THREE.CanvasTexture | null = null;

function blobs(g: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, color: string, size: [number, number], squash = 1) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const cx = hash(i, seed) * w, cy = h * (0.15 + hash(i, seed + 1) * 0.7);
    for (let k = 0; k < 14; k++) {
      const r = size[0] + hash(i * 31 + k, seed + 2) * (size[1] - size[0]);
      const x = cx + (hash(i * 31 + k, seed + 3) - 0.5) * r * 3, y = cy + (hash(i * 31 + k, seed + 4) - 0.5) * r * 2 * squash;
      for (const dx of [-w, 0, w]) { g.beginPath(); g.ellipse(x + dx, y, r, r * squash, 0, 0, Math.PI * 2); g.fill(); }
    }
  }
}

function earth() {
  if (earthTex) return earthTex;
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  const sea = g.createLinearGradient(0, 0, 0, 512); sea.addColorStop(0, "#1b4f9c"); sea.addColorStop(0.5, "#1f6fc4"); sea.addColorStop(1, "#1b4f9c");
  g.fillStyle = sea; g.fillRect(0, 0, 1024, 512);
  blobs(g, 1024, 512, 7, 1, "#3e8f4a", [18, 46], 0.8);       // continents
  blobs(g, 1024, 512, 6, 7, "#c8a86b", [8, 22], 0.7);        // deserts
  blobs(g, 1024, 512, 5, 13, "#2f6f3a", [8, 20], 0.8);       // forests
  g.fillStyle = "#f4f8ff"; g.fillRect(0, 0, 1024, 26); g.fillRect(0, 486, 1024, 26);   // ice caps
  earthTex = new THREE.CanvasTexture(c); earthTex.colorSpace = THREE.SRGBColorSpace; earthTex.anisotropy = 8;
  return earthTex;
}

function clouds() {
  if (cloudTex) return cloudTex;
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  blobs(g, 1024, 512, 16, 21, "rgba(255,255,255,0.55)", [6, 20], 0.45);
  cloudTex = new THREE.CanvasTexture(c); cloudTex.colorSpace = THREE.SRGBColorSpace;
  return cloudTex;
}

function moon() {
  if (moonTex) return moonTex;
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#a9a39a"; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 60; i++) {
    const r = 2 + hash(i, 41) * 9, x = hash(i, 42) * 256, y = hash(i, 43) * 128;
    g.fillStyle = "rgba(70,65,60,0.45)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(230,225,215,0.35)"; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2); g.fill();
  }
  moonTex = new THREE.CanvasTexture(c); moonTex.colorSpace = THREE.SRGBColorSpace;
  return moonTex;
}

/** Lumpy asteroid: an icosphere with its vertices pushed in and out. */
function useRockGeometry() {
  return useMemo(() => {
    const g = new THREE.IcosahedronGeometry(0.32, 2);
    const p = g.getAttribute("position") as THREE.BufferAttribute, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = 0.78 + 0.35 * (Math.sin(v.x * 9) * Math.cos(v.y * 7) * 0.5 + 0.5) + Math.sin(v.z * 13) * 0.05;
      v.multiplyScalar(n); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
}

function Nebula() {
  return (
    <group position={[0, 0, -20]}>
      {[[-12, 6, "#7b3fe4", 22], [10, -5, "#ff4fa3", 18], [3, 9, "#2fb5ff", 16], [-6, -8, "#ff8a3d", 12]].map(([x, y, c, s], i) => (
        <group key={i} position={[x as number, y as number, 0]}><Glow color={c as string} size={s as number} opacity={0.22} /></group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- scene

const Space = memo(function Space({ st, phase, onHud, onDie }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onDie: () => void }) {
  const planet = useRef<THREE.Mesh>(null), cloudLayer = useRef<THREE.Mesh>(null), shield = useRef<THREE.Group>(null), arc = useRef<THREE.Mesh>(null);
  const moonPivot = useRef<THREE.Group>(null), planetMat = useRef<THREE.MeshStandardMaterial>(null);
  const rocks = useRef<(THREE.Group | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const rockGeo = useRockGeometry();
  const tex = useMemo(() => ({ earth: earth(), clouds: clouds(), moon: moon() }), []);
  const arcs = useMemo(() => ({ normal: new THREE.TorusGeometry(R_SHIELD, 0.13, 12, 48, ARC * 2), wide: new THREE.TorusGeometry(R_SHIELD, 0.13, 12, 48, ARC * 3.2) }), []);

  useFrame((state, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    s.wide = Math.max(0, s.wide - dt);
    s.hurt = Math.max(0, s.hurt - dt * 1.5);
    const arcNow = ARC * (s.wide > 0 ? 1.6 : 1);
    s.aim = phase === "play" ? Math.atan2(state.pointer.y * 0.75, state.pointer.x) : s.t * 0.8;
    let d = s.aim - s.shield;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.shield += d * Math.min(1, dt * 14);
    if (phase === "play") {
      s.spawn -= dt;
      if (s.spawn <= 0) {
        s.spawn = Math.max(0.42, 1.25 - s.score * 0.012);
        const r = Math.random();
        const kind: Kind = r < 0.13 ? "gold" : r < 0.16 && s.lives < 3 ? "heart" : r < 0.2 ? "wide" : "rock";
        s.rocks.push({ a: Math.random() * Math.PI * 2, r: 11, v: 2.2 + Math.random() * 1.2 + s.score * 0.03, kind, alive: true, spin: Math.random() * 6 });
      }
      for (const k of s.rocks) {
        if (!k.alive) continue;
        k.r -= k.v * dt; k.spin += dt * 3;
        const x = Math.cos(k.a) * k.r, y = Math.sin(k.a) * k.r;
        if (k.r <= R_SHIELD + 0.25 && k.r > R_SHIELD - 0.4) {
          let off = k.a - s.shield; off = Math.atan2(Math.sin(off), Math.cos(off));
          if (Math.abs(off) < arcNow) {
            k.alive = false; s.streak += 1; s.score += k.kind === "gold" ? 5 : 1;
            if (k.kind === "heart") s.lives = Math.min(3, s.lives + 1);
            if (k.kind === "wide") s.wide = 6;
            burst(x, y, 0, BURST[k.kind], k.kind === "rock" ? 22 : 48);
            sfx(k.kind === "heart" || k.kind === "wide" ? "chime" : s.streak % 8 === 0 ? "combo" : k.kind === "gold" ? "coin" : "pop", Math.min(1, s.streak / 16));
            continue;
          }
        }
        if (k.r <= R_PLANET + 0.2) {
          k.alive = false;
          if (k.kind === "heart" || k.kind === "wide") continue;          // missed a power-up: no damage
          s.lives -= 1; s.streak = 0; s.shake = 0.5; s.hurt = 1;
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
    if (planet.current) planet.current.rotation.y += dt * 0.18;
    if (cloudLayer.current) cloudLayer.current.rotation.y += dt * 0.26;
    if (planetMat.current) planetMat.current.emissive.setRGB(s.hurt * 0.7, 0.02, 0.06);
    if (moonPivot.current) moonPivot.current.rotation.y += dt * 0.35;
    if (shield.current) shield.current.rotation.z = s.shield;
    if (arc.current) {
      const geo = s.wide > 0 ? arcs.wide : arcs.normal;
      if (arc.current.geometry !== geo) { arc.current.geometry = geo; arc.current.rotation.z = -arcNow; }
    }
    rocks.current.forEach((g, i) => {
      if (!g) return;
      const k = s.rocks[i];
      g.visible = !!k;
      if (!k) return;
      g.position.set(Math.cos(k.a) * k.r, Math.sin(k.a) * k.r, 0);
      // children: 0 rock, 1 gold, 2 heart, 3 crystal, 4 tail (rotated to point away from the planet), 5 glow
      (g.children[0] as THREE.Mesh).rotation.set(k.spin, k.spin * 0.7, 0);
      g.children[1].rotation.set(k.spin, k.spin * 0.7, 0);
      g.children[2].rotation.y = k.spin; g.children[3].rotation.set(k.spin * 0.5, k.spin, 0);
      g.children[0].visible = k.kind === "rock"; g.children[1].visible = k.kind === "gold";
      g.children[2].visible = k.kind === "heart"; g.children[3].visible = k.kind === "wide";
      g.children[4].visible = k.kind === "rock" || k.kind === "gold";
      g.children[4].rotation.z = k.a - Math.PI / 2;
    });
  });

  return (
    <>
      <color attach="background" args={["#05041a"]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[-6, 3, 5]} intensity={2.6} color="#fff1d6" />
      <Stars radius={70} depth={30} count={3500} factor={3.2} fade speed={0.6} />
      <Nebula />
      <Sparkles count={70} scale={[22, 14, 4]} size={2.5} speed={0.2} color="#8f7bff" />
      {/* planet: surface, clouds, atmosphere */}
      <mesh ref={planet} rotation-x={0.35}>
        <sphereGeometry args={[R_PLANET, 64, 48]} />
        <meshStandardMaterial ref={planetMat} map={tex.earth} roughness={0.75} metalness={0.05} />
      </mesh>
      <mesh ref={cloudLayer} rotation-x={0.35} scale={1.025}>
        <sphereGeometry args={[R_PLANET, 48, 36]} />
        <meshStandardMaterial map={tex.clouds} transparent depthWrite={false} roughness={1} />
      </mesh>
      <mesh scale={1.1}><sphereGeometry args={[R_PLANET, 48, 36]} /><meshBasicMaterial color="#5fb4ff" transparent opacity={0.12} side={THREE.BackSide} /></mesh>
      <Glow color="#4fa3ff" size={4.4} opacity={0.4} />
      {/* moon */}
      <group ref={moonPivot} rotation-x={0.5}>
        <mesh position={[4.3, 0, 0]}><sphereGeometry args={[0.3, 32, 24]} /><meshStandardMaterial map={tex.moon} roughness={1} /></mesh>
      </group>
      {/* orbit guide + shield */}
      <mesh><torusGeometry args={[R_SHIELD, 0.012, 6, 120]} /><meshBasicMaterial color="#8f7bff" transparent opacity={0.35} /></mesh>
      <group ref={shield}>
        <mesh ref={arc} rotation={[0, 0, -ARC]} geometry={arcs.normal}>
          <meshStandardMaterial color="#ff4fa3" emissive="#ff4fa3" emissiveIntensity={1.4} metalness={0.3} roughness={0.2} />
        </mesh>
        <group position={[R_SHIELD, 0, 0]}><Glow color="#ff4fa3" size={2.6} opacity={0.7} /></group>
      </group>
      {/* meteors and power-ups */}
      {Array.from({ length: POOL }, (_, i) => (
        <group key={i} ref={(g) => { rocks.current[i] = g; }} visible={false}>
          <mesh geometry={rockGeo}><meshStandardMaterial color="#8a7b6a" flatShading roughness={0.95} /></mesh>
          <mesh><octahedronGeometry args={[0.34, 0]} /><meshStandardMaterial color="#ffd23f" emissive="#c79a00" emissiveIntensity={1} flatShading metalness={0.6} /></mesh>
          <group scale={0.03}>
            <mesh position={[-4, 3, 0]}><sphereGeometry args={[6, 16, 12]} /><meshStandardMaterial color="#ff4f7d" emissive="#ff2b5c" emissiveIntensity={0.8} /></mesh>
            <mesh position={[4, 3, 0]}><sphereGeometry args={[6, 16, 12]} /><meshStandardMaterial color="#ff4f7d" emissive="#ff2b5c" emissiveIntensity={0.8} /></mesh>
            <mesh position={[0, -3, 0]} rotation-z={Math.PI}><coneGeometry args={[9.6, 12, 24]} /><meshStandardMaterial color="#ff4f7d" emissive="#ff2b5c" emissiveIntensity={0.8} /></mesh>
          </group>
          <mesh><icosahedronGeometry args={[0.3, 0]} /><meshPhysicalMaterial color="#c6f24e" emissive="#7fbf00" emissiveIntensity={1.2} roughness={0.1} flatShading /></mesh>
          {/* fiery tail trailing away from the planet */}
          <group>
            <mesh position={[0, 0.75, 0]}><coneGeometry args={[0.24, 1.3, 16, 1, true]} /><meshBasicMaterial color="#ff8a3d" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} /></mesh>
            <mesh position={[0, 0.5, 0]}><coneGeometry args={[0.14, 0.8, 12, 1, true]} /><meshBasicMaterial color="#ffe08a" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} /></mesh>
          </group>
          <Glow color="#ff8a3d" size={1.4} opacity={0.6} />
        </group>
      ))}
      {sparks}
    </>
  );
});

export function MeteorShield() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, lives: 3, streak: 0, wide: 0 });
  const [best, setBest] = usePersistent("best3dMeteor", 0);
  const start = () => { st.current = fresh(); setHud({ score: 0, lives: 3, streak: 0, wide: 0 }); setPhase("play"); };
  const onHud = useCallback((s: State) => setHud({ score: s.score, lives: s.lives, streak: s.streak, wide: s.wide }), []);
  const onDie = useCallback(() => { setPhase("over"); setBest((b) => Math.max(b, st.current.score)); setHud((h) => ({ ...h, lives: 0, score: st.current.score })); }, [setBest]);
  return (
    <GameFrame title="Meteor Shield" emoji="☄️" phase={phase} score={hud.score} best={best} lives={hud.lives} onStart={start}
      extra={<>
        {hud.streak >= 8 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">🔥 {hud.streak} streak</span>}
        {hud.wide > 0 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">🛡️ wide shield {Math.ceil(hud.wide)}s</span>}
      </>}
      how={<>Move the mouse around the planet to swing your shield and deflect the meteors. Gold meteors are worth 5, catch a pink heart to repair the planet and a green crystal for a wider shield. Three hits and the planet falls.</>}>
      <div className="absolute inset-0 cursor-crosshair touch-none">
        <Canvas camera={{ position: [0, -1.6, 10], fov: 55 }} dpr={[1, 1.75]}>
          <Space st={st} phase={phase} onHud={onHud} onDie={onDie} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
