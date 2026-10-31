"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox, Sky, Trail } from "@react-three/drei";
import { Eye, EyeOff } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";
import { Cloud, Flowers, Hills, grassTexture, lawnTexture, sandTexture, stoneTexture, useTex, waterTexture, woodTexture, Woodland } from "./scenery";

// ---------------------------------------------------------------- course data

const BALL = 0.07, CUP = 0.12, MAX_SPEED = 5.4, MIN_SPEED = 0.4, MAX_PULL = 2.2, MAX_STROKES = 8, G = 6.5, ROLL = 1.15;
type V2 = [number, number];
interface Box { x: number; z: number; w: number; d: number }
interface Hill { x: number; z: number; r: number; h: number }          // gaussian bump (h > 0) or dip (h < 0)
interface Sand { x: number; z: number; rx: number; rz: number }
interface Mover extends Box { ax: number; az: number; speed: number; phase: number }
interface Boost extends Box { dir: V2 }
interface Hole {
  name: string; par: number; W: number; L: number; start: V2; cup: V2;
  boxes?: Box[]; bumpers?: V2[]; hills?: Hill[]; sand?: Sand[]; water?: Box[]; movers?: Mover[]; boosts?: Boost[];
  portals?: { a: V2; b: V2 }[]; windmill?: { x: number; z: number; gap: number; speed: number };
  spinner?: { x: number; z: number; len: number; speed: number };
}

// The green spans x in [-W/2, W/2] and z in [-L/2, L/2]; you tee off at +z and putt towards -z.
const HOLES: Hole[] = [
  { name: "First Tee", par: 2, W: 2.4, L: 7, start: [0, 2.9], cup: [0, -2.8], hills: [{ x: 0.35, z: 0, r: 0.9, h: 0.14 }] },
  { name: "Bumper Alley", par: 3, W: 3, L: 8, start: [0, 3.4], cup: [0.4, -3.3], bumpers: [[-0.6, 1.1], [0.6, 0.1], [-0.5, -1], [0.55, -2.1]] },
  { name: "Bunker Hill", par: 3, W: 3.2, L: 8, start: [0, 3.4], cup: [0.2, -3.3], hills: [{ x: -0.6, z: 0.4, r: 1.2, h: 0.28 }],
    sand: [{ x: 0, z: -2.25, rx: 0.9, rz: 0.42 }, { x: 1.05, z: 0.8, rx: 0.45, rz: 0.75 }] },
  { name: "The Windmill", par: 3, W: 3, L: 8, start: [0, 3.4], cup: [0, -3.2], windmill: { x: 0, z: -0.6, gap: 0.44, speed: 1.3 },
    hills: [{ x: 0, z: -3.2, r: 0.75, h: -0.07 }] },
  { name: "Water Carry", par: 3, W: 3.2, L: 9, start: [0, 3.9], cup: [-0.8, -3.6],
    water: [{ x: -0.9, z: 0, w: 1.4, d: 1.6 }, { x: 0.95, z: 0, w: 1.3, d: 1.6 }], sand: [{ x: 0.45, z: -3.35, rx: 0.42, rz: 0.36 }] },
  { name: "The Bowl", par: 2, W: 3.4, L: 8, start: [0, 3.4], cup: [0, -2.4],
    hills: [{ x: 0, z: -2.4, r: 1.4, h: -0.36 }, { x: -0.95, z: 0.8, r: 0.6, h: 0.22 }, { x: 0.95, z: 0.8, r: 0.6, h: 0.22 }] },
  { name: "Rush Hour", par: 3, W: 3.2, L: 9, start: [0, 3.9], cup: [0, -3.7], bumpers: [[-1.1, -2.6], [1.1, -2.6]],
    movers: [{ x: 0, z: 1, w: 1.2, d: 0.25, ax: 0.9, az: 0, speed: 1.6, phase: 0 }, { x: 0, z: -1.2, w: 1.2, d: 0.25, ax: -0.9, az: 0, speed: 2.1, phase: 1 }] },
  { name: "Boost Loop", par: 3, W: 3.4, L: 9, start: [-0.9, 3.9], cup: [-1, -3.6], boxes: [{ x: -0.45, z: 0.2, w: 2.5, d: 0.22 }],
    boosts: [{ x: 1.2, z: 1.5, w: 0.6, d: 1, dir: [0, -1] }], spinner: { x: -0.6, z: -1.8, len: 1.3, speed: 2 } },
  { name: "Portal Finale", par: 4, W: 3.4, L: 10, start: [-0.9, 4.4], cup: [0.9, -4.3], boxes: [{ x: 0, z: -0.5, w: 3.4, d: 0.25 }],
    portals: [{ a: [1.1, 1.6], b: [-1.1, -1.8] }], water: [{ x: 0.5, z: -3, w: 1.6, d: 0.9 }], bumpers: [[-0.3, -3.1]],
    hills: [{ x: -1, z: 2.4, r: 0.8, h: 0.16 }] },
];
const PAR_TOTAL = HOLES.reduce((a, h) => a + h.par, 0);
const towerWood = () => woodTexture("#c98a52");

const heightAt = (h: Hole, x: number, z: number) =>
  (h.hills ?? []).reduce((y, k) => y + k.h * Math.exp(-((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r)), 0);

function slopeAt(h: Hole, x: number, z: number, out: THREE.Vector2) {
  out.set(0, 0);
  for (const k of h.hills ?? []) {
    const e = k.h * Math.exp(-((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r)), f = -2 / (k.r * k.r);
    out.x += e * f * (x - k.x); out.y += e * f * (z - k.z);
  }
  return out;
}

const moverPos = (m: Mover, t: number): Box => ({ ...m, x: m.x + m.ax * Math.sin(t * m.speed + m.phase), z: m.z + m.az * Math.sin(t * m.speed + m.phase) });
const inBox = (p: THREE.Vector2, b: Box) => Math.abs(p.x - b.x) < b.w / 2 && Math.abs(p.y - b.z) < b.d / 2;
const windmillDown = (wm: NonNullable<Hole["windmill"]>, t: number) => {
  // four blades; the gap is blocked while one of them sweeps through the bottom
  const a = (((t * wm.speed) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
  return a < 0.26 || a > Math.PI / 2 - 0.26;
};
function windmillWalls(h: Hole, t: number): Box[] {
  const wm = h.windmill;
  if (!wm) return [];
  const half = h.W / 2, l = wm.x - wm.gap / 2, r = wm.x + wm.gap / 2;
  const walls: Box[] = [{ x: (-half + l) / 2, z: wm.z, w: l + half, d: 0.6 }, { x: (r + half) / 2, z: wm.z, w: half - r, d: 0.6 }];
  if (windmillDown(wm, t)) walls.push({ x: wm.x, z: wm.z, w: wm.gap, d: 0.6 });
  return walls;
}

// ---------------------------------------------------------------- physics

interface Ball { pos: THREE.Vector2; vel: THREE.Vector2; cool: number }
type Ev = "wall" | "bumper" | "spin" | "cup" | "water" | "portal" | "lip" | "rest";
const tmpA = new THREE.Vector2(), tmpB = new THREE.Vector2(), tmpN = new THREE.Vector2();

function collideBox(b: Ball, box: Box, bounce = 1.75) {
  const cx = THREE.MathUtils.clamp(b.pos.x, box.x - box.w / 2, box.x + box.w / 2), cz = THREE.MathUtils.clamp(b.pos.y, box.z - box.d / 2, box.z + box.d / 2);
  const dx = b.pos.x - cx, dz = b.pos.y - cz, d = Math.hypot(dx, dz);
  if (d >= BALL) return false;
  if (d === 0) { tmpN.set(0, Math.sign(b.pos.y - box.z) || 1); b.pos.y = box.z + tmpN.y * (box.d / 2 + BALL); }
  else { tmpN.set(dx / d, dz / d); b.pos.addScaledVector(tmpN, BALL - d); }
  const vn = b.vel.dot(tmpN);
  if (vn < 0) b.vel.addScaledVector(tmpN, -bounce * vn);
  return vn < -0.3;
}

function collideCircle(b: Ball, c: V2, r: number, bounce: number, kick = 0) {
  tmpA.set(b.pos.x - c[0], b.pos.y - c[1]);
  const d = tmpA.length(), R = r + BALL;
  if (d >= R || d === 0) return false;
  tmpA.divideScalar(d);
  b.pos.set(c[0] + tmpA.x * R, c[1] + tmpA.y * R);
  const vn = b.vel.dot(tmpA);
  if (vn < 0) b.vel.addScaledVector(tmpA, -bounce * vn);
  b.vel.addScaledVector(tmpA, kick);
  return true;
}

function collideSegment(b: Ball, a: THREE.Vector2, e: THREE.Vector2, push: THREE.Vector2) {
  tmpB.copy(e).sub(a);
  const t = THREE.MathUtils.clamp(tmpA.copy(b.pos).sub(a).dot(tmpB) / tmpB.lengthSq(), 0, 1);
  const cx = a.x + tmpB.x * t, cz = a.y + tmpB.y * t, d = Math.hypot(b.pos.x - cx, b.pos.y - cz), r = BALL + 0.045;
  if (d >= r || d === 0) return false;
  tmpN.set((b.pos.x - cx) / d, (b.pos.y - cz) / d);
  b.pos.set(cx + tmpN.x * r, cz + tmpN.y * r);
  const vn = b.vel.dot(tmpN);
  if (vn < 0) b.vel.addScaledVector(tmpN, -1.7 * vn);
  b.vel.addScaledVector(push, 0.8);
  return true;
}

const g2 = new THREE.Vector2();
/** Advance the ball by k seconds at course time t. Returns the most notable event, if any. */
function step(b: Ball, h: Hole, k: number, t: number): Ev | null {
  let ev: Ev | null = null;
  b.cool = Math.max(0, b.cool - k);
  // slopes pull the ball downhill; sand grabs it
  slopeAt(h, b.pos.x, b.pos.y, g2);
  b.vel.addScaledVector(g2, -G * k);
  for (const pad of h.boosts ?? []) if (inBox(b.pos, pad)) b.vel.add(tmpA.set(...pad.dir).multiplyScalar(7 * k));
  const sandy = (h.sand ?? []).some((s) => ((b.pos.x - s.x) / s.rx) ** 2 + ((b.pos.y - s.z) / s.rz) ** 2 < 1);
  const mu = sandy ? 4.5 : ROLL;
  const sp = b.vel.length();
  if (sp > 0) b.vel.multiplyScalar(Math.max(0, sp - mu * k) / sp);
  if (b.vel.length() > MAX_SPEED * 1.4) b.vel.setLength(MAX_SPEED * 1.4);
  b.pos.addScaledVector(b.vel, k);

  // rails
  const hx = h.W / 2 - BALL, hz = h.L / 2 - BALL;
  if (Math.abs(b.pos.x) > hx) { b.pos.x = Math.sign(b.pos.x) * hx; if (Math.abs(b.vel.x) > 0.3) ev = "wall"; b.vel.x *= -0.72; }
  if (Math.abs(b.pos.y) > hz) { b.pos.y = Math.sign(b.pos.y) * hz; if (Math.abs(b.vel.y) > 0.3) ev = "wall"; b.vel.y *= -0.72; }
  for (const box of [...(h.boxes ?? []), ...windmillWalls(h, t)]) if (collideBox(b, box)) ev = "wall";
  for (const m of h.movers ?? []) if (collideBox(b, moverPos(m, t), 1.9)) ev = "wall";
  for (const c of h.bumpers ?? []) if (collideCircle(b, c, 0.14, 2.1, 0.6)) ev = "bumper";
  if (h.spinner) {
    const s = h.spinner, ang = t * s.speed;
    tmpN.set(Math.cos(ang), Math.sin(ang)).multiplyScalar(s.len / 2);
    const a = new THREE.Vector2(s.x - tmpN.x, s.z - tmpN.y), e = new THREE.Vector2(s.x + tmpN.x, s.z + tmpN.y);
    if (collideSegment(b, a, e, new THREE.Vector2(-tmpN.y, tmpN.x).multiplyScalar(s.speed * 0.7))) ev = "spin";
  }
  for (const p of h.portals ?? []) {
    if (b.cool <= 0 && Math.hypot(b.pos.x - p.a[0], b.pos.y - p.a[1]) < 0.17) {
      const dir = b.vel.lengthSq() > 0 ? b.vel.clone().normalize() : new THREE.Vector2(0, -1);
      b.pos.set(p.b[0] + dir.x * 0.22, p.b[1] + dir.y * 0.22); b.cool = 0.6; ev = "portal";
    }
  }
  for (const w of h.water ?? []) if (inBox(b.pos, w)) return "water";

  // the cup: slow enough drops in, too fast lips out (and gets a little tug)
  const dc = Math.hypot(b.pos.x - h.cup[0], b.pos.y - h.cup[1]);
  if (dc < CUP) {
    if (b.vel.length() < 2.5) return "cup";
    b.vel.add(tmpA.set(h.cup[0] - b.pos.x, h.cup[1] - b.pos.y).multiplyScalar(0.7));
    ev = ev ?? "lip";
  }
  if (b.vel.lengthSq() < 0.0012 && g2.lengthSq() * G * G < 0.5) { b.vel.set(0, 0); return "rest"; }
  return ev;
}

// ---------------------------------------------------------------- game state

interface State {
  hole: number; ball: Ball; lastRest: THREE.Vector2; strokes: number; card: number[]; points: number; moving: boolean; movingT: number;
  sunk: number; t: number; aimFrom: THREE.Vector2 | null; aim: THREE.Vector2 | null; msg: string; msgT: number;
  intro: number; camDir: THREE.Vector2; overview: boolean; flagLift: number; bumped: number[];
}
const newBall = (h: Hole): Ball => ({ pos: new THREE.Vector2(...h.start), vel: new THREE.Vector2(), cool: 0 });
const fresh = (first = 0): State => ({
  hole: first, ball: newBall(HOLES[first]), lastRest: new THREE.Vector2(...HOLES[first].start), strokes: 0, card: [], points: 0, moving: false, movingT: 0,
  sunk: 0, t: 0, aimFrom: null, aim: null, msg: "", msgT: 0, intro: 2.4, camDir: new THREE.Vector2(0, 1), overview: false, flagLift: 0, bumped: [],
});
const label = (strokes: number, par: number) =>
  strokes === 1 ? "Hole in one!" : ({ [-3]: "Albatross!", [-2]: "Eagle!", [-1]: "Birdie!", 0: "Par", 1: "Bogey", 2: "Double bogey" } as Record<number, string>)[strokes - par] ?? `+${strokes - par}`;

// ---------------------------------------------------------------- scene pieces

function Green({ hole }: { hole: Hole }) {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(hole.W, hole.L, Math.round(hole.W * 22), Math.round(hole.L * 22));
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(hole, p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, [hole]);
  const map = useTex(grassTexture, hole.W / 2, hole.L / 2);
  return <mesh geometry={geo} receiveShadow><meshStandardMaterial map={map} roughness={0.92} /></mesh>;
}

function Rails({ hole }: { hole: Hole }) {
  const wood = useTex(woodTexture, 4, 1);
  const { W, L } = hole, t = 0.14;
  const rails: [number, number, number, number][] = [[-W / 2 - t / 2, 0, t, L + 2 * t], [W / 2 + t / 2, 0, t, L + 2 * t], [0, -L / 2 - t / 2, W, t], [0, L / 2 + t / 2, W, t]];
  return (
    <>
      {rails.map(([x, z, w, d], i) => (
        <RoundedBox key={i} args={[w, 0.46, d]} radius={0.035} position={[x, -0.07, z]} castShadow receiveShadow>
          <meshStandardMaterial map={wood} roughness={0.6} />
        </RoundedBox>
      ))}
      {/* brass corner caps */}
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], i) => (
        <mesh key={i} position={[sx * (W / 2 + t / 2), 0.18, sz * (L / 2 + t / 2)]} castShadow>
          <sphereGeometry args={[0.07, 16, 12]} /><meshStandardMaterial color="#d8b04a" metalness={0.85} roughness={0.25} />
        </mesh>
      ))}
    </>
  );
}

function Windmill({ wm, W }: { wm: NonNullable<Hole["windmill"]>; W: number }) {
  const blades = useRef<THREE.Group>(null);
  const wood = useTex(towerWood, 2, 2), stone = useTex(stoneTexture, 2, 1);
  useFrame(({ clock }) => { if (blades.current) blades.current.rotation.z = -clock.elapsedTime * wm.speed; });
  const half = W / 2, l = wm.x - wm.gap / 2, r = wm.x + wm.gap / 2;
  return (
    <group>
      {/* stone walls either side of the tower */}
      {[[(-half + l) / 2, l + half], [(r + half) / 2, half - r]].map(([x, w], i) => (
        <RoundedBox key={i} args={[w, 0.24, 0.5]} radius={0.04} position={[x, 0.1, wm.z]} castShadow receiveShadow><meshStandardMaterial map={stone} roughness={0.9} /></RoundedBox>
      ))}
      <group position={[wm.x, 0, wm.z]}>
        {/* tower with an arch for the ball */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (wm.gap / 2 + 0.22), 0.55, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.44, 1.1, 0.6]} /><meshStandardMaterial map={wood} roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 0.85, 0]} castShadow><boxGeometry args={[wm.gap + 0.88, 0.5, 0.6]} /><meshStandardMaterial map={wood} roughness={0.7} /></mesh>
        <mesh position={[0, 1.38, 0]} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[0.85, 0.65, 4]} /><meshStandardMaterial color="#b8412f" roughness={0.6} /></mesh>
        {/* windows */}
        {[-1, 1].map((s) => <mesh key={s} position={[s * 0.45, 0.62, 0.305]}><planeGeometry args={[0.16, 0.2]} /><meshStandardMaterial color="#ffe9a8" emissive="#ffcf5a" emissiveIntensity={0.5} /></mesh>)}
        {/* sails */}
        <group ref={blades} position={[0, 0.95, 0.36]}>
          <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 0.1, 16]} /><meshStandardMaterial color="#444" metalness={0.7} roughness={0.3} /></mesh>
          {[0, 1, 2, 3].map((i) => (
            <group key={i} rotation-z={(i * Math.PI) / 2}>
              <mesh position={[0, -0.47, 0]} castShadow><boxGeometry args={[0.05, 0.9, 0.03]} /><meshStandardMaterial color="#6b4428" /></mesh>
              <mesh position={[0.1, -0.5, 0.01]} castShadow><boxGeometry args={[0.17, 0.7, 0.01]} /><meshStandardMaterial color="#f6efe0" side={THREE.DoubleSide} roughness={0.8} /></mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

function Water({ w }: { w: Box }) {
  const map = useTex(waterTexture, w.w, w.d);
  const stone = useTex(stoneTexture, 2, 1);
  useFrame((_, dt) => { map.offset.x += dt * 0.05; map.offset.y += dt * 0.03; });
  const b = 0.06;
  return (
    <group position={[w.x, 0, w.z]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]} receiveShadow>
        <planeGeometry args={[w.w, w.d]} /><meshStandardMaterial map={map} roughness={0.08} metalness={0.25} transparent opacity={0.92} />
      </mesh>
      {[[0, -w.d / 2, w.w + 2 * b, b], [0, w.d / 2, w.w + 2 * b, b], [-w.w / 2, 0, b, w.d], [w.w / 2, 0, b, w.d]].map(([x, z, ww, d], i) => (
        <mesh key={i} position={[x, 0.02, z]} receiveShadow castShadow><boxGeometry args={[ww, 0.05, d]} /><meshStandardMaterial map={stone} roughness={0.9} /></mesh>
      ))}
    </group>
  );
}

function BoostPad({ pad }: { pad: Boost }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff8a00"; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#fff3a0"; g.beginPath(); g.moveTo(8, 44); g.lineTo(32, 16); g.lineTo(56, 44); g.lineTo(44, 44); g.lineTo(32, 30); g.lineTo(20, 44); g.fill();
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1, pad.d / pad.w * 1.5);
    return t;
  }, [pad]);
  useFrame((_, dt) => { tex.offset.y -= dt * 1.4; });
  const ang = Math.atan2(pad.dir[0], -pad.dir[1]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, -ang]} position={[pad.x, 0.008, pad.z]}>
      <planeGeometry args={[pad.w, pad.d]} /><meshStandardMaterial map={tex} emissive="#ff8a00" emissiveIntensity={0.6} roughness={0.4} />
    </mesh>
  );
}

function Portal({ at, color }: { at: V2; color: string }) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ring.current) { ring.current.rotation.z = clock.elapsedTime * 2; ring.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 4) * 0.06); } });
  return (
    <group position={[at[0], 0.01, at[1]]}>
      <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[0.2, 32]} /><meshBasicMaterial color="#120d1f" /></mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2}><torusGeometry args={[0.21, 0.035, 12, 40]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} /></mesh>
      <pointLight color={color} intensity={1.2} distance={1.5} position={[0, 0.25, 0]} />
    </group>
  );
}

function Bumper({ at, st, idx }: { at: V2; st: React.RefObject<State>; idx: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const hit = st.current.bumped[idx] ?? 0;
    if (g.current) g.current.scale.set(1 + hit * 0.35, 1, 1 + hit * 0.35);
  });
  return (
    <group ref={g} position={[at[0], 0, at[1]]}>
      <mesh position={[0, 0.09, 0]} castShadow><cylinderGeometry args={[0.14, 0.15, 0.18, 24]} /><meshStandardMaterial color="#e63946" roughness={0.35} /></mesh>
      <mesh position={[0, 0.09, 0]}><torusGeometry args={[0.145, 0.025, 10, 28]} /><meshStandardMaterial color="#ffffff" roughness={0.3} /></mesh>
      <mesh position={[0, 0.19, 0]}><sphereGeometry args={[0.07, 16, 12]} /><meshStandardMaterial color="#ffd23f" emissive="#ffb000" emissiveIntensity={0.8} /></mesh>
    </group>
  );
}

function CameraRig({ st, phase }: { st: React.RefObject<State>; phase: Phase }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0, 0));
  const want = useMemo(() => new THREE.Vector3(), []), lookWant = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, raw) => {
    const s = st.current, h = HOLES[s.hole], dt = Math.min(raw, 0.05), b = s.ball.pos;
    if (s.intro > 0 || s.overview || phase !== "play") {
      // fly over the whole hole, looking down its length
      const sweep = s.intro > 0 ? s.intro / 2.4 : 0;
      want.set(Math.sin(sweep * 1.2) * 2.5, h.L * 0.72 + 2.2, h.L * 0.62 + 1.5 + sweep * 2);
      lookWant.set(0, 0, -0.3);
    } else {
      if (!s.moving && !s.aim) {
        // settle behind the ball, facing the cup
        tmpA.set(b.x - h.cup[0], b.y - h.cup[1]);
        if (tmpA.lengthSq() > 0.01) s.camDir.lerp(tmpA.normalize(), 1 - Math.exp(-2.5 * dt)).normalize();
      }
      const y = heightAt(h, b.x, b.y);
      want.set(b.x + s.camDir.x * 3.1, y + 2.4, b.y + s.camDir.y * 3.1);
      lookWant.set(b.x - s.camDir.x * 1.3, y, b.y - s.camDir.y * 1.3);
    }
    const k = 1 - Math.exp(-(s.aim ? 0 : 3) * dt);         // hold still while aiming so the drag stays put
    camera.position.lerp(want, k);
    look.current.lerp(lookWant, k);
    camera.lookAt(look.current);
  });
  return null;
}

// ---------------------------------------------------------------- the course

const Course = memo(function Course({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const ball = useRef<THREE.Mesh>(null);
  const flag = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Group>(null);
  const movers = useRef<(THREE.Object3D | null)[]>([]);
  const dots = useRef<THREE.InstancedMesh>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const [holeIdx, setHoleIdx] = useState(() => st.current.hole);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const hole = HOLES[holeIdx];
  const lawn = useTex(lawnTexture, 30, 30);
  const sand = useTex(sandTexture, 2, 2);
  const o = useMemo(() => new THREE.Object3D(), []), q = useMemo(() => new THREE.Quaternion(), []), axis = useMemo(() => new THREE.Vector3(), []);

  const toast = (s: State, msg: string, t = 1.6) => { s.msg = msg; s.msgT = t; };

  useFrame((_, raw) => {
    const s = st.current, h = HOLES[s.hole], dt = Math.min(raw, 0.033);
    s.t += dt;
    if (s.msgT > 0) s.msgT -= dt;
    if (s.intro > 0) s.intro -= dt;
    for (let i = 0; i < s.bumped.length; i++) s.bumped[i] = Math.max(0, (s.bumped[i] ?? 0) - dt * 4);

    if (phase === "play" && s.moving) {
      s.movingT += dt;
      const steps = 10, k = dt / steps;
      for (let i = 0; i < steps; i++) {
        const ev = step(s.ball, h, k, s.t - dt + i * k);
        if (!ev) continue;
        if (ev === "wall") sfx("tick");
        else if (ev === "bumper") {
          sfx("pop", 4);
          (h.bumpers ?? []).forEach((c, j) => { if (Math.hypot(s.ball.pos.x - c[0], s.ball.pos.y - c[1]) < 0.3) s.bumped[j] = 1; });
        } else if (ev === "spin") sfx("hit");
        else if (ev === "portal") { sfx("whoosh"); burst(s.ball.pos.x, 0.2, s.ball.pos.y, "#b48cff", 30); }
        else if (ev === "water") {
          sfx("wrong"); burst(s.ball.pos.x, 0.1, s.ball.pos.y, "#7fd3ff", 40);
          s.strokes += 1; s.moving = false; s.ball.vel.set(0, 0); s.ball.pos.copy(s.lastRest);
          toast(s, "Splash! +1 penalty stroke");
          break;
        } else if (ev === "cup") {
          s.moving = false; s.sunk = 1.6; s.ball.vel.set(0, 0);
          const diff = s.strokes - h.par;
          const pts = Math.max(1, 6 - diff * 2) + (s.strokes === 1 ? 6 : 0);
          s.points += pts; s.card.push(s.strokes);
          toast(s, `${label(s.strokes, h.par)} +${pts}`, 1.9);
          sfx(diff <= -1 ? "combo" : "coin");
          burst(h.cup[0], heightAt(h, ...h.cup) + 0.25, h.cup[1], s.strokes === 1 ? "#ffd23f" : diff <= -1 ? "#ff4fa3" : "#c6f24e", s.strokes === 1 ? 90 : 45);
          break;
        } else if (ev === "rest") {
          s.moving = false; s.lastRest.copy(s.ball.pos);
          if (s.strokes >= MAX_STROKES) { s.card.push(MAX_STROKES); s.sunk = 1.2; toast(s, `Picked up (max ${MAX_STROKES})`); }
          break;
        }
      }
      if (s.moving && s.movingT > 14) { s.moving = false; s.ball.vel.set(0, 0); s.lastRest.copy(s.ball.pos); }
    }

    if (s.sunk > 0) {
      s.sunk -= dt;
      if (s.sunk <= 0) {
        if (s.hole + 1 >= HOLES.length) onEnd();
        else {
          s.hole += 1; s.strokes = 0; s.ball = newBall(HOLES[s.hole]); s.lastRest.set(...HOLES[s.hole].start);
          s.intro = 2.4; s.camDir.set(0, 1); s.bumped = []; setHoleIdx(s.hole); sfx("chime");
        }
      }
    }

    // ball
    const bp = s.ball.pos, groundY = heightAt(h, bp.x, bp.y);
    if (ball.current) {
      const inCup = s.sunk > 0 && s.card[s.card.length - 1] !== MAX_STROKES;
      if (inCup) { bp.lerp(tmpA.set(...h.cup), 0.2); }
      ball.current.position.set(bp.x, inCup ? groundY + BALL - Math.min(0.2, (1.6 - s.sunk) * 0.5) : groundY + BALL, bp.y);
      const sp = s.ball.vel.length();
      if (sp > 0.001) {
        axis.set(s.ball.vel.y, 0, -s.ball.vel.x).normalize();
        q.setFromAxisAngle(axis, (sp * dt) / BALL);
        ball.current.quaternion.premultiply(q);
      }
    }

    // obstacles
    if (spinner.current && h.spinner) spinner.current.rotation.y = -s.t * h.spinner.speed;
    (h.movers ?? []).forEach((m, i) => { const p = moverPos(m, s.t); movers.current[i]?.position.set(p.x, 0.1, p.z); });

    // the flagstick lifts out as the ball rolls up to the cup
    const near = Math.hypot(bp.x - h.cup[0], bp.y - h.cup[1]);
    s.flagLift = THREE.MathUtils.lerp(s.flagLift, s.moving && near < 1.4 ? 1 : 0, 1 - Math.exp(-5 * dt));
    if (flag.current) {
      flag.current.position.y = heightAt(h, ...h.cup) + s.flagLift * 0.9;
      flag.current.rotation.z = s.flagLift * 0.5;
      flag.current.children[1].rotation.y = Math.sin(s.t * 3) * 0.35;
    }

    // keep the sun's shadow box on the ball
    if (sun.current) {
      sun.current.position.set(bp.x + 4, 8, bp.y + 3);
      sun.current.target.position.set(bp.x, 0, bp.y);
      sun.current.target.updateMatrixWorld();
    }

    // aiming guide: simulate the putt and draw where it will roll
    if (dots.current) {
      const a = s.aim, show = !!a && !s.moving && phase === "play" && a.length() > 0.05;
      dots.current.visible = show;
      if (show && a) {
        const sim: Ball = { pos: bp.clone(), vel: a.clone().normalize().multiplyScalar(MIN_SPEED + (Math.min(a.length(), MAX_PULL) / MAX_PULL) * (MAX_SPEED - MIN_SPEED)), cool: 0 };
        const k = 1 / 240;
        let n = 0;
        for (let i = 1; i <= 360 && n < 36; i++) {
          const ev = step(sim, h, k, s.t + i * k);
          if (i % 10 === 0) {
            o.position.set(sim.pos.x, heightAt(h, sim.pos.x, sim.pos.y) + 0.03, sim.pos.y);
            o.scale.setScalar(1 - n / 40); o.updateMatrix(); dots.current.setMatrixAt(n++, o.matrix);
          }
          if (ev === "cup" || ev === "water" || ev === "rest") break;
        }
        for (let j = n; j < 36; j++) { o.scale.setScalar(0); o.updateMatrix(); dots.current.setMatrixAt(j, o.matrix); }
        dots.current.instanceMatrix.needsUpdate = true;
        (dots.current.material as THREE.MeshBasicMaterial).color.setHSL(0.33 - (Math.min(a.length(), MAX_PULL) / MAX_PULL) * 0.33, 0.95, 0.6);
      }
    }

    hud.current += dt;
    if (hud.current > 0.08) { hud.current = 0; onHud({ ...s }); }
  });

  // drag anywhere: pull back like a slingshot, release to putt
  const toXZ = (e: ThreeEvent<PointerEvent>) => new THREE.Vector2(e.point.x, e.point.z);
  const down = (e: ThreeEvent<PointerEvent>) => {
    const s = st.current;
    if (phase !== "play" || s.moving || s.sunk > 0 || s.intro > 0.6) return;
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    s.aimFrom = toXZ(e); s.aim = new THREE.Vector2();
  };
  const move = (e: ThreeEvent<PointerEvent>) => { const s = st.current; if (s.aimFrom) s.aim = s.aimFrom.clone().sub(toXZ(e)); };
  const up = () => {
    const s = st.current;
    const a = s.aim; s.aim = null; s.aimFrom = null;
    if (!a || a.length() < 0.08 || phase !== "play" || s.moving) return;
    const p = Math.min(a.length(), MAX_PULL) / MAX_PULL;
    s.ball.vel.copy(a.clone().normalize().multiplyScalar(MIN_SPEED + p * (MAX_SPEED - MIN_SPEED)));
    s.camDir.copy(a).normalize().negate();
    s.moving = true; s.movingT = 0; s.strokes += 1; s.lastRest.copy(s.ball.pos);
    sfx("pop", p * 6);
  };

  const cupY = heightAt(hole, ...hole.cup);
  const frames = useMemo(() => {
    const rect = (w: number, d: number) => { const r = new THREE.Path(); r.moveTo(-w / 2, -d / 2); r.lineTo(w / 2, -d / 2); r.lineTo(w / 2, d / 2); r.lineTo(-w / 2, d / 2); r.closePath(); return r; };
    const frame = (ow: number, od: number, iw: number, id: number) => {
      const sh = new THREE.Shape(rect(ow, od).getPoints()); sh.holes.push(rect(iw, id));
      const g = new THREE.ShapeGeometry(sh);
      const uv = g.getAttribute("uv") as THREE.BufferAttribute, pos = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / ow + 0.5, pos.getY(i) / od + 0.5);    // 0..1 like a plane, so map.repeat still applies
      return g;
    };
    return { lawn: frame(120, 120, hole.W + 1.4, hole.L + 1.4), fringe: frame(hole.W + 1.4, hole.L + 1.4, hole.W, hole.L) };
  }, [hole]);
  return (
    <>
      <CameraRig st={st} phase={phase} />
      <Sky sunPosition={[40, 22, 20]} turbidity={3} rayleigh={0.8} mieCoefficient={0.004} mieDirectionalG={0.85} />
      <fog attach="fog" args={["#cfe8f7", 22, 60]} />
      <hemisphereLight args={["#ffffff", "#5a8a3a", 0.75]} />
      <directionalLight ref={sun} intensity={2.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-7} shadow-camera-right={7} shadow-camera-top={7} shadow-camera-bottom={-7} shadow-camera-far={30} />
      <Environment resolution={128}>
        <Lightformer intensity={1.4} position={[0, 6, 2]} scale={[12, 4, 1]} />
        <Lightformer intensity={0.6} color="#bfe6ff" position={[-6, 3, -4]} scale={[6, 3, 1]} />
      </Environment>

      {/* surroundings */}
      {/* lawn and fringe are frames with a hole where the green is, so dips in the green stay visible */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.03, 0]} receiveShadow geometry={frames.lawn}><meshStandardMaterial map={lawn} roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow geometry={frames.fringe}><meshStandardMaterial color="#5f9e45" roughness={1} /></mesh>
      <Hills radius={38} count={11} />
      <Woodland key={`w${holeIdx}`} inner={hole.L / 2 + 2.6} outer={hole.L / 2 + 14} count={46} seed={holeIdx * 7} />
      <Flowers center={[-hole.W / 2 - 1.2, 1]} radius={0.8} count={36} seed={holeIdx} />
      <Flowers center={[hole.W / 2 + 1.3, -1.6]} radius={0.7} count={30} seed={holeIdx + 9} />
      {[[-14, 9, -24, 1.6, 0.4], [10, 11, -30, 2.2, 0.25], [24, 8, -12, 1.3, 0.35], [-26, 12, -8, 2, 0.3]].map(([x, y, z, sc, sp], i) => (
        <Cloud key={i} position={[x, y, z]} scale={sc} speed={sp} span={80} />
      ))}

      {/* the hole */}
      <group key={holeIdx}>
        <Green hole={hole} />
        <Rails hole={hole} />
        {(hole.boxes ?? []).map((b, i) => (
          <RoundedBox key={i} args={[b.w, 0.22, b.d]} radius={0.04} position={[b.x, 0.1, b.z]} castShadow receiveShadow>
            <meshStandardMaterial color={i % 2 ? "#ff4fa3" : "#4d7cff"} roughness={0.4} />
          </RoundedBox>
        ))}
        {(hole.sand ?? []).map((s, i) => (
          <mesh key={i} rotation-x={-Math.PI / 2} position={[s.x, heightAt(hole, s.x, s.z) + 0.006, s.z]} scale={[s.rx, s.rz, 1]} receiveShadow>
            <circleGeometry args={[1, 40]} /><meshStandardMaterial map={sand} roughness={1} polygonOffset polygonOffsetFactor={-2} />
          </mesh>
        ))}
        {(hole.water ?? []).map((w, i) => <Water key={i} w={w} />)}
        {(hole.boosts ?? []).map((p, i) => <BoostPad key={i} pad={p} />)}
        {(hole.portals ?? []).map((p, i) => <group key={i}><Portal at={p.a} color="#4dc3ff" /><Portal at={p.b} color="#ff8a3d" /></group>)}
        {(hole.bumpers ?? []).map((c, i) => <Bumper key={i} at={c} st={st} idx={i} />)}
        {(hole.movers ?? []).map((m, i) => (
          <RoundedBox key={i} ref={(el) => { movers.current[i] = el; }} args={[m.w, 0.22, m.d]} radius={0.05} position={[m.x, 0.1, m.z]} castShadow>
            <meshStandardMaterial color={i % 2 ? "#ffd23f" : "#7ee8c8"} roughness={0.35} metalness={0.1} />
          </RoundedBox>
        ))}
        {hole.windmill && <Windmill wm={hole.windmill} W={hole.W} />}
        {hole.spinner && (
          <group position={[hole.spinner.x, 0, hole.spinner.z]}>
            <mesh position={[0, 0.1, 0]} castShadow><cylinderGeometry args={[0.08, 0.11, 0.2, 20]} /><meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} /></mesh>
            <group ref={spinner}>
              <RoundedBox args={[hole.spinner.len, 0.12, 0.09]} radius={0.03} position={[0, 0.12, 0]} castShadow><meshStandardMaterial color="#ffd23f" roughness={0.35} /></RoundedBox>
            </group>
          </group>
        )}
        {/* cup: dark hole with a white liner */}
        <group position={[hole.cup[0], cupY, hole.cup[1]]}>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]}><circleGeometry args={[CUP, 40]} /><meshBasicMaterial color="#0b140c" polygonOffset polygonOffsetFactor={-4} /></mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]}><ringGeometry args={[CUP - 0.012, CUP, 40]} /><meshStandardMaterial color="#f4f4f4" polygonOffset polygonOffsetFactor={-5} /></mesh>
        </group>
        <group ref={flag} position={[hole.cup[0], cupY, hole.cup[1]]}>
          <mesh position={[0, 0.65, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, 1.3]} /><meshStandardMaterial color="#f2f2f2" metalness={0.6} roughness={0.3} /></mesh>
          <group position={[0, 1.18, 0]}>
            <mesh position={[0.17, 0, 0]} castShadow><boxGeometry args={[0.34, 0.2, 0.006]} /><meshStandardMaterial color="#e63946" side={THREE.DoubleSide} /></mesh>
          </group>
        </group>
        {/* tee box */}
        <mesh rotation-x={-Math.PI / 2} position={[hole.start[0], heightAt(hole, ...hole.start) + 0.004, hole.start[1]]}>
          <planeGeometry args={[0.55, 0.4]} /><meshStandardMaterial color="#2c7a37" roughness={0.9} polygonOffset polygonOffsetFactor={-2} />
        </mesh>
      </group>

      {/* aim surface (invisible, catches drags anywhere) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <planeGeometry args={[60, 60]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <instancedMesh ref={dots} args={[undefined, undefined, 36]} visible={false}>
        <sphereGeometry args={[0.025, 10, 8]} /><meshBasicMaterial color="#c6f24e" transparent opacity={0.9} />
      </instancedMesh>
      <Trail width={0.9} length={5} color="#ffffff" attenuation={(t) => t * t * 0.6}>
        <mesh ref={ball} castShadow><sphereGeometry args={[BALL, 32, 24]} /><meshPhysicalMaterial color="#ffffff" roughness={0.3} clearcoat={1} clearcoatRoughness={0.15} /></mesh>
      </Trail>
      <ContactShadows position={[0, 0.003, 0]} opacity={0.35} scale={14} blur={2} far={1.2} />
      {sparks}
    </>
  );
});

// ---------------------------------------------------------------- shell

interface Hud { hole: number; strokes: number; points: number; card: number[]; msg: string; msgT: number; intro: number; power: number; aiming: boolean; overview: boolean }

export function MiniGolf() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState(0);
  const [hud, setHud] = useState<Hud>({ hole: 0, strokes: 0, points: 0, card: [], msg: "", msgT: 0, intro: 0, power: 0, aiming: false, overview: false });
  const [best, setBest] = usePersistent("best3dGolf", 0);
  const start = () => { st.current = fresh(); setRun((r) => r + 1); setPhase("play"); };
  const end = useCallback(() => { setPhase("over"); setBest((b) => Math.max(b, st.current.points)); }, [setBest]);
  const onHud = useCallback((s: State) => setHud({ hole: s.hole, strokes: s.strokes, points: s.points, card: [...s.card], msg: s.msg, msgT: s.msgT, intro: s.intro,
    power: s.aim ? Math.min(1, s.aim.length() / MAX_PULL) : 0, aiming: !!s.aim && s.aim.length() > 0.05, overview: s.overview }), []);
  const h = HOLES[hud.hole];
  const played = hud.card.reduce((a, b) => a + b, 0), parSoFar = HOLES.slice(0, hud.card.length).reduce((a, x) => a + x.par, 0);
  const rel = played - parSoFar;
  const chip = "rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur";

  return (
    <GameFrame title="Mini Golf" emoji="⛳" phase={phase} score={hud.points} best={best} onStart={start} height={520}
      extra={<>
        <span className={chip}>⛳ {hud.hole + 1}/{HOLES.length} · par {h.par}</span>
        <span className={chip}>🏌️ {hud.strokes}</span>
        {hud.card.length > 0 && <span className={chip}>{rel === 0 ? "E" : rel > 0 ? `+${rel}` : rel}</span>}
        <button onClick={() => { st.current.overview = !st.current.overview; }} title="Toggle overview camera"
          className="pointer-events-auto rounded-xl border-2 border-white/30 bg-black/40 p-1.5 backdrop-blur">
          {hud.overview ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </>}
      summary={hud.card.length > 0 && (
        <div className="mx-auto mt-3 overflow-x-auto rounded-xl border-2 border-white/25 bg-black/30 text-xs">
          <table className="tabular-nums">
            <tbody>
              <tr className="text-white/60"><td className="px-2 py-1 text-left font-bold">Hole</td>{HOLES.map((_, i) => <td key={i} className="px-1.5">{i + 1}</td>)}<td className="px-2 font-bold">Tot</td></tr>
              <tr className="text-white/60"><td className="px-2 py-1 text-left font-bold">Par</td>{HOLES.map((x, i) => <td key={i} className="px-1.5">{x.par}</td>)}<td className="px-2">{PAR_TOTAL}</td></tr>
              <tr className="font-extrabold"><td className="px-2 py-1 text-left">You</td>
                {HOLES.map((x, i) => { const v = hud.card[i]; return <td key={i} className={`px-1.5 ${v == null ? "" : v < x.par ? "text-[#c6f24e]" : v > x.par ? "text-[#ff8fb8]" : ""}`}>{v ?? "–"}</td>; })}
                <td className="px-2">{played}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      how={<>Drag anywhere and pull back like a slingshot, then let go to putt. The dotted line shows where it will roll. Hills curve the ball, sand slows it, water costs a stroke. Time the windmill, ride boost pads, jump through portals. 9 holes, par {PAR_TOTAL}.</>}>
      <div className="absolute inset-0 touch-none">
        <Canvas key={run} shadows camera={{ position: [0, 8, 9], fov: 50, near: 0.05, far: 200 }} dpr={[1, 1.75]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
          <Course st={st} phase={phase} onEnd={end} onHud={onHud} />
        </Canvas>
        {/* hole intro banner */}
        {phase === "play" && hud.intro > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 grid place-items-center text-center text-white" style={{ opacity: Math.min(1, hud.intro) }}>
            <div className="rounded-2xl border-2 border-white/30 bg-black/45 px-6 py-3 backdrop-blur">
              <div className="text-xs font-bold uppercase tracking-widest text-white/70">Hole {hud.hole + 1} of {HOLES.length}</div>
              <div className="font-display text-3xl font-extrabold">{h.name}</div>
              <div className="text-sm font-bold text-[#c6f24e]">Par {h.par}</div>
            </div>
          </div>
        )}
        {phase === "play" && hud.msgT > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-16 grid place-items-center">
            <span className="rounded-xl border-2 border-[#121212] bg-[#c6f24e] px-3 py-1.5 font-display text-lg font-extrabold text-[#121212] shadow-[3px_3px_0_#121212]">{hud.msg}</span>
          </div>
        )}
        {/* power meter */}
        {phase === "play" && hud.aiming && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 w-56 -translate-x-1/2">
            <div className="mb-1 text-center text-xs font-bold text-white drop-shadow">Power {Math.round(hud.power * 100)}%</div>
            <div className="h-3 overflow-hidden rounded-full border-2 border-white/60 bg-black/40">
              <div className="h-full rounded-full" style={{ width: `${hud.power * 100}%`, background: `hsl(${120 - hud.power * 120} 90% 55%)` }} />
            </div>
          </div>
        )}
        {phase === "play" && !hud.aiming && hud.intro <= 0 && hud.strokes === 0 && (
          <div className="pointer-events-none absolute bottom-4 inset-x-0 text-center text-xs font-bold text-white/85 drop-shadow">drag back anywhere · release to putt</div>
        )}
      </div>
    </GameFrame>
  );
}
