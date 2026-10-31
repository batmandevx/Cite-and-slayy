"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";

const W = 3.2, L = 8, BALL = 0.07, CUP = 0.13, FRICTION = 0.9, MAX_SPEED = 7, PAR = 3;
interface Box { x: number; z: number; w: number; d: number }
interface Hole { start: [number, number]; cup: [number, number]; boxes: Box[]; spinner?: { x: number; z: number; len: number; speed: number } }

// Six handmade holes (green is x in [-W/2, W/2], z in [-L/2, L/2]; you putt towards -z).
const HOLES: Hole[] = [
  { start: [0, 3.3], cup: [0, -3.2], boxes: [] },
  { start: [-1, 3.3], cup: [1, -3.1], boxes: [{ x: -0.3, z: 0, w: 2.2, d: 0.25 }] },
  { start: [0, 3.3], cup: [0, -3.2], boxes: [{ x: -0.95, z: -0.6, w: 1.2, d: 0.25 }, { x: 0.95, z: 0.9, w: 1.2, d: 0.25 }] },
  { start: [1.1, 3.3], cup: [-1.1, -3.2], boxes: [{ x: 0, z: 0.2, w: 0.4, d: 2.4 }], spinner: { x: -0.8, z: -1.6, len: 1.2, speed: 1.6 } },
  { start: [0, 3.3], cup: [0, -3.3], boxes: [{ x: 0, z: -2.2, w: 1.4, d: 0.22 }], spinner: { x: 0, z: 0.4, len: 1.6, speed: -2.2 } },
  { start: [-1.2, 3.3], cup: [1.1, -3.3], boxes: [{ x: -0.5, z: 1.4, w: 2.2, d: 0.22 }, { x: 0.5, z: -1.1, w: 2.2, d: 0.22 }], spinner: { x: 0.9, z: 0.2, len: 1.0, speed: 2.6 } },
];

interface State { hole: number; pos: THREE.Vector2; vel: THREE.Vector2; strokes: number; total: number; points: number; moving: boolean; sunk: number; t: number; aim: THREE.Vector2 | null; msg: string; msgT: number; angle: number }
const fresh = (): State => ({ hole: 0, pos: new THREE.Vector2(...HOLES[0].start), vel: new THREE.Vector2(), strokes: 0, total: 0, points: 0, moving: false, sunk: 0, t: 0, aim: null, msg: "", msgT: 0, angle: 0 });

function collideBox(p: THREE.Vector2, v: THREE.Vector2, b: Box) {
  const cx = THREE.MathUtils.clamp(p.x, b.x - b.w / 2, b.x + b.w / 2), cz = THREE.MathUtils.clamp(p.y, b.z - b.d / 2, b.z + b.d / 2);
  const dx = p.x - cx, dz = p.y - cz, d = Math.hypot(dx, dz);
  if (d >= BALL || d === 0) return false;
  const n = new THREE.Vector2(dx / d, dz / d);
  p.addScaledVector(n, BALL - d);
  const vn = v.dot(n);
  if (vn < 0) v.addScaledVector(n, -1.8 * vn);
  return true;
}

function collideSegment(p: THREE.Vector2, v: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2, push: THREE.Vector2) {
  const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  const c = a.clone().addScaledVector(ab, t), d = p.distanceTo(c), r = BALL + 0.04;
  if (d >= r || d === 0) return false;
  const n = p.clone().sub(c).divideScalar(d);
  p.addScaledVector(n, r - d);
  const vn = v.dot(n);
  if (vn < 0) v.addScaledVector(n, -1.7 * vn);
  v.addScaledVector(push, 0.8);
  return true;
}

function Course({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const ball = useRef<THREE.Mesh>(null);
  const flag = useRef<THREE.Group>(null);
  const spinner = useRef<THREE.Mesh>(null);
  const aimLine = useRef<THREE.Mesh>(null);
  const [holeIdx, setHoleIdx] = useState(0);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const hole = HOLES[holeIdx];

  useFrame((_, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.033);
    s.t += dt;
    if (s.msgT > 0) s.msgT -= dt;
    const h = HOLES[s.hole];
    s.angle += (h.spinner?.speed ?? 0) * dt;
    if (phase === "play" && s.moving) {
      const steps = 8, k = dt / steps;
      for (let i = 0; i < steps; i++) {
        s.pos.addScaledVector(s.vel, k);
        const sp = s.vel.length();
        if (sp > 0) s.vel.multiplyScalar(Math.max(0, sp - FRICTION * k) / sp);
        // walls
        if (Math.abs(s.pos.x) > W / 2 - BALL) { s.pos.x = Math.sign(s.pos.x) * (W / 2 - BALL); s.vel.x *= -0.75; sfx("tick"); }
        if (Math.abs(s.pos.y) > L / 2 - BALL) { s.pos.y = Math.sign(s.pos.y) * (L / 2 - BALL); s.vel.y *= -0.75; sfx("tick"); }
        for (const b of h.boxes) if (collideBox(s.pos, s.vel, b)) sfx("tick");
        if (h.spinner) {
          const c = new THREE.Vector2(h.spinner.x, h.spinner.z), dir = new THREE.Vector2(Math.cos(s.angle), Math.sin(s.angle)).multiplyScalar(h.spinner.len / 2);
          const tangential = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(h.spinner.speed * 0.6);
          if (collideSegment(s.pos, s.vel, c.clone().sub(dir), c.clone().add(dir), tangential)) sfx("hit");
        }
        // the cup: slow enough and close enough drops in, too fast lips out
        const cup = new THREE.Vector2(...h.cup), d = s.pos.distanceTo(cup);
        if (d < CUP) {
          if (s.vel.length() < 2.6) {
            s.moving = false; s.sunk = 1.4;
            const pts = Math.max(1, 6 - s.strokes) + (s.strokes === 1 ? 4 : 0);
            s.points += pts; s.total += s.strokes;
            const diff = s.strokes - PAR;
            s.msg = s.strokes === 1 ? `Hole in one! +${pts}` : diff <= -1 ? `Birdie! +${pts}` : diff === 0 ? `Par +${pts}` : `In! +${pts}`;
            s.msgT = 1.8;
            sfx(s.strokes <= 2 ? "combo" : "coin");
            burst(cup.x, 0.2, cup.y, s.strokes === 1 ? "#ffd23f" : "#c6f24e", s.strokes === 1 ? 70 : 36);
            break;
          }
          s.vel.add(cup.clone().sub(s.pos).multiplyScalar(0.6));    // lip: the cup tugs at it
        }
        if (s.vel.lengthSq() < 0.0009) { s.vel.set(0, 0); s.moving = false; if (s.strokes >= 8) { s.msg = "Picked up (max 8)"; s.msgT = 1.4; s.total += 8; s.sunk = 1.2; } break; }
      }
    }
    if (s.sunk > 0) {
      s.sunk -= dt;
      if (s.sunk <= 0) {
        if (s.hole + 1 >= HOLES.length) { onEnd(); }
        else { s.hole += 1; s.strokes = 0; s.pos.set(...HOLES[s.hole].start); s.vel.set(0, 0); setHoleIdx(s.hole); }
      }
    }
    if (ball.current) {
      const inCup = s.sunk > 0 && s.strokes < 8;
      ball.current.position.set(s.pos.x, inCup ? Math.max(-0.1, BALL - (1.4 - s.sunk) * 0.4) : BALL, s.pos.y);
      if (s.moving) { ball.current.rotation.x -= s.vel.y * dt / BALL; ball.current.rotation.z += s.vel.x * dt / BALL; }
    }
    if (spinner.current && h.spinner) spinner.current.rotation.y = -s.angle;
    if (flag.current) flag.current.rotation.y = Math.sin(s.t * 2) * 0.3;
    if (aimLine.current) {
      const a = s.aim;
      aimLine.current.visible = !!a && !s.moving && phase === "play";
      if (a) {
        const len = Math.min(a.length(), 2.2);
        aimLine.current.scale.set(1, 1, Math.max(0.01, len));
        aimLine.current.position.set(s.pos.x - (a.x / (a.length() || 1)) * len / 2, 0.02, s.pos.y - (a.y / (a.length() || 1)) * len / 2);
        aimLine.current.rotation.y = Math.atan2(-a.x, -a.y);
        (aimLine.current.material as THREE.MeshBasicMaterial).color.setHSL(0.33 - Math.min(1, len / 2.2) * 0.33, 0.9, 0.55);
      }
    }
    hud.current += dt;
    if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
  });

  const toXZ = (e: ThreeEvent<PointerEvent>) => new THREE.Vector2(e.point.x, e.point.z);
  const down = (e: ThreeEvent<PointerEvent>) => {
    const s = st.current;
    if (phase !== "play" || s.moving || s.sunk > 0) return;
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    s.aim = s.pos.clone().sub(toXZ(e));
  };
  const move = (e: ThreeEvent<PointerEvent>) => { const s = st.current; if (s.aim) s.aim = s.pos.clone().sub(toXZ(e)); };
  const up = () => {
    const s = st.current;
    const a = s.aim; s.aim = null;
    if (!a || a.length() < 0.08 || phase !== "play" || s.moving) return;
    const p = Math.min(a.length(), 2.2) / 2.2;
    s.vel.copy(a.clone().normalize().multiplyScalar(0.5 + p * (MAX_SPEED - 0.5)));
    s.moving = true; s.strokes += 1;
    sfx("pop");
  };

  return (
    <>
      <color attach="background" args={["#bfe6ff"]} />
      <fog attach="fog" args={["#bfe6ff", 14, 30]} />
      <hemisphereLight args={["#ffffff", "#4a7a3a", 0.8]} />
      <directionalLight position={[4, 8, 3]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <Environment resolution={128}><Lightformer intensity={1.6} position={[0, 5, 2]} scale={[10, 4, 1]} /></Environment>
      {/* lawn around the course */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.06, 0]} receiveShadow><planeGeometry args={[40, 40]} /><meshStandardMaterial color="#7dbb52" roughness={1} /></mesh>
      {/* putting green (also the aiming surface) */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <planeGeometry args={[W, L]} /><meshStandardMaterial color="#3fa34d" roughness={0.85} />
      </mesh>
      {/* wooden rails */}
      {[[-W / 2 - 0.06, 0, 0.12, L + 0.24], [W / 2 + 0.06, 0, 0.12, L + 0.24], [0, -L / 2 - 0.06, W, 0.12], [0, L / 2 + 0.06, W, 0.12]].map(([x, z, w, d], i) => (
        <RoundedBox key={i} args={[w, 0.16, d]} radius={0.03} position={[x, 0.05, z]} castShadow receiveShadow><meshStandardMaterial color="#a8743f" roughness={0.55} /></RoundedBox>
      ))}
      {hole.boxes.map((b, i) => (
        <RoundedBox key={`${holeIdx}-${i}`} args={[b.w, 0.18, b.d]} radius={0.04} position={[b.x, 0.08, b.z]} castShadow receiveShadow>
          <meshStandardMaterial color={i % 2 ? "#ff4fa3" : "#4d7cff"} roughness={0.45} />
        </RoundedBox>
      ))}
      {hole.spinner && (
        <group position={[hole.spinner.x, 0, hole.spinner.z]}>
          <mesh position={[0, 0.08, 0]} castShadow><cylinderGeometry args={[0.08, 0.1, 0.16, 16]} /><meshStandardMaterial color="#333" metalness={0.6} roughness={0.3} /></mesh>
          <mesh ref={spinner} position={[0, 0.1, 0]} castShadow><boxGeometry args={[hole.spinner.len, 0.12, 0.08]} /><meshStandardMaterial color="#ffd23f" metalness={0.2} roughness={0.4} /></mesh>
        </group>
      )}
      {/* cup + flag */}
      <mesh rotation-x={-Math.PI / 2} position={[hole.cup[0], 0.003, hole.cup[1]]}><circleGeometry args={[CUP, 32]} /><meshStandardMaterial color="#0d1a10" /></mesh>
      <group ref={flag} position={[hole.cup[0], 0, hole.cup[1]]}>
        <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[0.012, 0.012, 1.2]} /><meshStandardMaterial color="#f2f2f2" metalness={0.6} roughness={0.3} /></mesh>
        <mesh position={[0.15, 1.08, 0]}><boxGeometry args={[0.3, 0.18, 0.005]} /><meshStandardMaterial color="#e63946" side={THREE.DoubleSide} /></mesh>
      </group>
      {/* tee mat */}
      <mesh rotation-x={-Math.PI / 2} position={[hole.start[0], 0.002, hole.start[1]]}><planeGeometry args={[0.5, 0.5]} /><meshStandardMaterial color="#2e7d3a" /></mesh>
      <mesh ref={aimLine} visible={false}><boxGeometry args={[0.035, 0.01, 1]} /><meshBasicMaterial color="#c6f24e" transparent opacity={0.85} /></mesh>
      <mesh ref={ball} castShadow><sphereGeometry args={[BALL, 32, 32]} /><meshPhysicalMaterial color="#ffffff" roughness={0.35} clearcoat={1} /></mesh>
      <ContactShadows position={[0, 0.004, 0]} opacity={0.4} scale={10} blur={1.8} far={1} />
      {sparks}
    </>
  );
}

export function MiniGolf() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState(0);
  const [hud, setHud] = useState({ hole: 0, strokes: 0, points: 0, total: 0, msg: "", msgT: 0 });
  const [best, setBest] = usePersistent("best3dGolf", 0);
  const start = () => { st.current = fresh(); setRun((r) => r + 1); setPhase("play"); };
  const end = () => { setPhase("over"); setBest((b) => Math.max(b, st.current.points)); };
  return (
    <GameFrame title="Mini Golf" emoji="⛳" phase={phase} score={hud.points} best={best} onStart={start}
      extra={<>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">⛳ {hud.hole + 1}/{HOLES.length} · par {PAR}</span>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">🏌️ {hud.strokes}</span>
        {hud.msgT > 0 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">{hud.msg}</span>}
      </>}
      how={<>Drag back from the ball like a slingshot and let go to putt. The longer the line, the harder the shot. Bounce off rails, time the spinning bars, and don&apos;t hit the cup too fast. 6 holes.</>}>
      <div className="absolute inset-0 touch-none">
        <Canvas key={run} shadows camera={{ position: [0, 7.4, 7.2], fov: 46 }} dpr={[1, 1.75]} onCreated={({ camera }) => camera.lookAt(0, 0, 0.2)}>
          <Course st={st} phase={phase} onHud={(s) => setHud({ hole: s.hole, strokes: s.strokes, points: s.points, total: s.total, msg: s.msg, msgT: s.msgT })} onEnd={end} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
