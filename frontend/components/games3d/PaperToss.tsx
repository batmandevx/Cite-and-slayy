"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";
import { hash, useTex, woodTexture } from "./scenery";

const darkWood = () => woodTexture("#6b4a2f");
const floorWood = () => woodTexture("#b98a5e");
const shelfWood = () => woodTexture("#8a5f3a");

/** A furnished office: plank floor, rug, window with a city view, bookshelf, plant, lamp, posters and a clock. */
function Office() {
  const floor = useTex(floorWood, 6, 14), shelf = useTex(shelfWood, 1, 2);
  const clock = useRef<THREE.Group>(null);
  useFrame(({ clock: c }) => { if (clock.current) { clock.current.children[0].rotation.z = -c.elapsedTime * 0.5; clock.current.children[1].rotation.z = -c.elapsedTime * 0.04; } });
  const bookColors = ["#e63946", "#4d7cff", "#ffd23f", "#2a9d8f", "#ff8a3d", "#8f7bff", "#f4f1ea", "#ff4fa3"];
  return (
    <group>
      {/* floor planks and a rug */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[14, 16]} /><meshStandardMaterial map={floor} roughness={0.55} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, -0.6]} receiveShadow><planeGeometry args={[4.6, 3.4]} /><meshStandardMaterial color="#3b4a7a" roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -0.6]}><ringGeometry args={[1.25, 1.35, 64]} /><meshStandardMaterial color="#ffd23f" roughness={1} /></mesh>
      {/* walls with skirting */}
      <mesh position={[0, 3, -6]} receiveShadow><planeGeometry args={[14, 6]} /><meshStandardMaterial color="#efe7da" /></mesh>
      <mesh position={[-7, 3, 0]} rotation-y={Math.PI / 2} receiveShadow><planeGeometry args={[16, 6]} /><meshStandardMaterial color="#e6dccb" /></mesh>
      <mesh position={[7, 3, 0]} rotation-y={-Math.PI / 2} receiveShadow><planeGeometry args={[16, 6]} /><meshStandardMaterial color="#e6dccb" /></mesh>
      <mesh position={[0, 0.08, -5.98]}><boxGeometry args={[14, 0.16, 0.03]} /><meshStandardMaterial color="#fffaf0" /></mesh>
      {/* window: sky, city skyline, frame and mullions */}
      <group position={[2.6, 2.5, -5.97]}>
        <mesh><planeGeometry args={[2.6, 1.8]} /><meshBasicMaterial color="#9fd3ff" /></mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[-1.15 + i * 0.29, -0.9 + (0.25 + hash(i, 3) * 0.55) / 2, 0.005]}>
            <planeGeometry args={[0.24, 0.25 + hash(i, 3) * 0.55]} /><meshBasicMaterial color={i % 2 ? "#6f86a8" : "#5c7396"} />
          </mesh>
        ))}
        <mesh position={[0.75, 0.55, 0.004]}><circleGeometry args={[0.16, 24]} /><meshBasicMaterial color="#fff3b0" /></mesh>
        {[[0, 0.93, 2.76, 0.08], [0, -0.93, 2.76, 0.08], [-1.34, 0, 0.08, 1.94], [1.34, 0, 0.08, 1.94], [0, 0, 0.05, 1.8], [0, 0.1, 2.6, 0.05]].map(([x, y, w, h], i) => (
          <mesh key={i} position={[x, y, 0.02]}><boxGeometry args={[w, h, 0.06]} /><meshStandardMaterial color="#fafafa" roughness={0.4} /></mesh>
        ))}
        <mesh position={[0, -1.02, 0.08]}><boxGeometry args={[2.9, 0.06, 0.2]} /><meshStandardMaterial color="#fafafa" /></mesh>
      </group>
      <pointLight position={[2.6, 2.5, -4.6]} intensity={6} distance={6} color="#dff0ff" />
      {/* framed posters */}
      {[[-2.4, 2.4, 1.2, 1.6, "#ff4fa3"], [-0.7, 2.7, 0.9, 0.7, "#4d7cff"]].map(([x, y, w, h, c], i) => (
        <group key={i} position={[x as number, y as number, -5.97]}>
          <mesh><boxGeometry args={[(w as number) + 0.1, (h as number) + 0.1, 0.03]} /><meshStandardMaterial color="#1f1f1f" /></mesh>
          <mesh position={[0, 0, 0.02]}><planeGeometry args={[w as number, h as number]} /><meshStandardMaterial color={c as string} /></mesh>
          <mesh position={[0, 0, 0.025]}><circleGeometry args={[(w as number) * 0.25, 24]} /><meshStandardMaterial color="#ffd23f" /></mesh>
        </group>
      ))}
      {/* wall clock */}
      <group position={[0.6, 4.2, -5.95]}>
        <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.32, 0.32, 0.05, 40]} /><meshStandardMaterial color="#fffdf7" /></mesh>
        <mesh position={[0, 0, 0.02]}><torusGeometry args={[0.32, 0.025, 8, 40]} /><meshStandardMaterial color="#222" /></mesh>
        <group ref={clock} position={[0, 0, 0.035]}>
          <group><mesh position={[0, 0.11, 0]}><boxGeometry args={[0.015, 0.22, 0.01]} /><meshBasicMaterial color="#e63946" /></mesh></group>
          <group><mesh position={[0, 0.07, 0]}><boxGeometry args={[0.03, 0.15, 0.01]} /><meshBasicMaterial color="#222" /></mesh></group>
        </group>
      </group>
      {/* bookshelf against the left wall */}
      <group position={[-6.6, 0, -2]} rotation-y={Math.PI / 2}>
        <mesh position={[0, 1.3, 0]} castShadow receiveShadow><boxGeometry args={[2.2, 2.6, 0.6]} /><meshStandardMaterial map={shelf} roughness={0.7} /></mesh>
        <mesh position={[0, 1.3, 0.04]}><boxGeometry args={[2.05, 2.45, 0.56]} /><meshStandardMaterial color="#3a2616" /></mesh>
        {[0.45, 1.1, 1.75, 2.4].map((y, r) => (
          <group key={r} position={[-0.95, y - 0.3, 0.1]}>
            <mesh position={[0.95, -0.03, 0]}><boxGeometry args={[2.05, 0.05, 0.5]} /><meshStandardMaterial map={shelf} /></mesh>
            {Array.from({ length: 14 }, (_, i) => {
              const h = 0.38 + hash(i, r * 9) * 0.18, w = 0.09 + hash(i, r * 9 + 1) * 0.05;
              return <mesh key={i} position={[0.08 + i * 0.13, h / 2, 0]} rotation-z={hash(i, r) > 0.9 ? 0.2 : 0} castShadow>
                <boxGeometry args={[w, h, 0.32]} /><meshStandardMaterial color={bookColors[(i + r * 3) % bookColors.length]} roughness={0.7} />
              </mesh>;
            })}
          </group>
        ))}
      </group>
      {/* potted plant */}
      <group position={[5.6, 0, -4.8]}>
        <mesh position={[0, 0.35, 0]} castShadow><cylinderGeometry args={[0.4, 0.3, 0.7, 24]} /><meshStandardMaterial color="#d96c4a" roughness={0.8} /></mesh>
        {Array.from({ length: 11 }, (_, i) => {
          const a = (i / 11) * Math.PI * 2, tilt = 0.35 + hash(i, 2) * 0.5;
          return (
            <group key={i} position={[0, 0.7, 0]} rotation={[Math.cos(a) * tilt, a, Math.sin(a) * tilt]}>
              <mesh position={[0, 0.55, 0]} scale={[0.22, 0.6, 0.05]} castShadow><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color={i % 2 ? "#2f8f46" : "#3fa857"} roughness={0.6} /></mesh>
            </group>
          );
        })}
      </group>
      {/* floor lamp */}
      <group position={[5.8, 0, 1.5]}>
        <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.3, 0.32, 0.04, 24]} /><meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} /></mesh>
        <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[0.025, 0.025, 2.4]} /><meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} /></mesh>
        <mesh position={[0, 2.45, 0]}><cylinderGeometry args={[0.22, 0.38, 0.4, 24, 1, true]} /><meshStandardMaterial color="#fff1c9" emissive="#ffd88a" emissiveIntensity={0.7} side={THREE.DoubleSide} /></mesh>
        <pointLight position={[0, 2.3, 0]} intensity={5} distance={7} color="#ffd9a0" />
      </group>
    </group>
  );
}

const G = 9.8, R = 0.11, RIM_R = 0.26, RIM_H = 0.52, BALLS = 10, START = new THREE.Vector3(0, 1.15, 2.6);
const ANGLE = 0.86, DOTS = 26;
/** Launch velocity for an aim: power p in [0, 1] and yaw in radians. */
const launch = (p: number, yaw: number) => {
  const v = 3.6 + p * 5.2, h = v * Math.cos(ANGLE);
  return new THREE.Vector3(h * Math.sin(yaw), v * Math.sin(ANGLE), -h * Math.cos(yaw));
};
interface State {
  aim: { p: number; yaw: number } | null;
  pos: THREE.Vector3; vel: THREE.Vector3; flying: boolean; touched: boolean; scored: boolean; settle: number;
  bin: THREE.Vector3; wind: number; left: number; score: number; streak: number; t: number; msg: string; msgT: number;
}
const fresh = (): State => ({ aim: null, pos: START.clone(), vel: new THREE.Vector3(), flying: false, touched: false, scored: false, settle: 0,
  bin: new THREE.Vector3(0, 0, -2.2), wind: 0, left: BALLS, score: 0, streak: 0, t: 0, msg: "", msgT: 0 });

/** A crumpled-paper ball: a jittered icosahedron with flat shading. */
function usePaperGeometry() {
  return useMemo(() => {
    const g = new THREE.IcosahedronGeometry(R, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + (Math.sin(v.x * 91 + v.y * 37) * 0.5 + Math.cos(v.z * 53 + v.x * 17) * 0.5) * 0.16;
      p.setXYZ(i, v.x * k, v.y * k, v.z * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
}

function Room({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const ball = useRef<THREE.Mesh>(null);
  const bin = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Mesh>(null);
  const fanBlades = useRef<THREE.Group>(null);
  const deskWood = useTex(darkWood, 2, 1);
  const hud = useRef(0);
  const geo = usePaperGeometry();
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  const [sparks, burst] = useSparks();

  const nextBall = (s: State) => {
    s.flying = false; s.touched = false; s.scored = false; s.settle = 0;
    s.pos.copy(START); s.vel.set(0, 0, 0);
    s.left -= 1;
    if (s.left <= 0) { onEnd(); return; }
    // the bin moves further away as you get better, and the fan changes
    const far = Math.min(4.6, 2.2 + s.streak * 0.35 + Math.random() * 0.6);
    s.bin.set((Math.random() - 0.5) * 1.6, 0, -far);
    s.wind = (Math.random() - 0.5) * (0.6 + Math.min(2.4, s.streak * 0.4));
  };

  useFrame((_, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.033);
    s.t += dt;
    if (s.msgT > 0) s.msgT -= dt;
    if (phase === "play" && s.flying) {
      const steps = 4, h = dt / steps;
      for (let k = 0; k < steps; k++) {
        s.vel.y -= G * h;
        s.vel.x += s.wind * h;
        s.vel.multiplyScalar(1 - 0.08 * h);
        const prevY = s.pos.y;
        s.pos.addScaledVector(s.vel, h);
        // rim: a torus of radius RIM_R at height RIM_H
        const dx = s.pos.x - s.bin.x, dz = s.pos.z - s.bin.z;
        const radial = Math.hypot(dx, dz);
        const closest = new THREE.Vector3(s.bin.x + (dx / (radial || 1)) * RIM_R, RIM_H, s.bin.z + (dz / (radial || 1)) * RIM_R);
        const d = s.pos.distanceTo(closest);
        if (d < R + 0.012) {
          const n = s.pos.clone().sub(closest).normalize();
          s.vel.addScaledVector(n, -1.6 * s.vel.dot(n)).multiplyScalar(0.72);
          s.pos.copy(closest).addScaledVector(n, R + 0.013);
          if (!s.touched) sfx("tick");
          s.touched = true;
        }
        // through the opening, going down: basket
        if (!s.scored && prevY >= RIM_H && s.pos.y < RIM_H && radial < RIM_R - R * 0.6) {
          s.scored = true; s.streak += 1;
          const dist = Math.hypot(s.bin.x - START.x, s.bin.z - START.z);
          const pts = 1 + (s.touched ? 0 : 1) + (dist > 3.6 ? 1 : 0);
          s.score += pts;
          s.msg = s.touched ? `In! +${pts}` : `Swish! +${pts}`; s.msgT = 1.4;
          sfx(s.touched ? "coin" : "combo");
          burst(s.bin.x, RIM_H + 0.2, s.bin.z, s.touched ? "#ffd23f" : "#c6f24e", 40);
        }
        // inside the bin: settle at the bottom
        if (s.scored && s.pos.y < 0.12 + R) { s.pos.y = 0.12 + R; s.vel.set(0, 0, 0); }
        // bin wall from outside
        if (!s.scored && s.pos.y < RIM_H && radial < RIM_R + R && radial > RIM_R - R) {
          const n = new THREE.Vector3(dx, 0, dz).normalize();
          s.vel.addScaledVector(n, -1.5 * s.vel.dot(n)).multiplyScalar(0.6);
          s.pos.x = s.bin.x + n.x * (RIM_R + R + 0.002); s.pos.z = s.bin.z + n.z * (RIM_R + R + 0.002);
        }
        // floor
        if (s.pos.y < R) {
          s.pos.y = R;
          if (s.vel.y < -0.6) sfx("tick");
          s.vel.y = -s.vel.y * 0.35; s.vel.x *= 0.8; s.vel.z *= 0.8;
        }
      }
      const slow = s.vel.length() < 0.25 && s.pos.y < R + 0.02;
      s.settle += dt;
      if (s.scored ? s.settle > 1.1 : (slow && s.settle > 0.8) || s.settle > 3.5 || Math.abs(s.pos.z) > 9) {
        if (!s.scored) { s.streak = 0; s.msg = "Miss"; s.msgT = 0.9; sfx("wrong"); }
        nextBall(s);
      }
    }
    // aiming arc (gravity only: reading the wind is your job)
    const v = s.aim && !s.flying && phase === "play" ? launch(s.aim.p, s.aim.yaw) : null;
    dots.current.forEach((m, k) => {
      if (!m) return;
      if (!v) { m.visible = false; return; }
      const t = (k + 1) * 0.06;
      const y = START.y + v.y * t - 0.5 * G * t * t;
      m.visible = y > 0.02;
      m.position.set(START.x + v.x * t, y, START.z + v.z * t);
      m.scale.setScalar(1 - k / (DOTS * 1.4));
    });
    if (ball.current) {
      ball.current.position.copy(s.pos);
      if (s.aim && !s.flying) ball.current.position.z += s.aim.p * 0.25;    // wind-up
      if (s.flying) { ball.current.rotation.x -= dt * 9; ball.current.rotation.z += dt * 3; }
    }
    if (bin.current) bin.current.position.lerp(s.bin, 0.12);
    if (fanBlades.current) fanBlades.current.rotation.z += dt * (2 + Math.abs(s.wind) * 9) * Math.sign(s.wind || 1);
    if (flag.current) { flag.current.rotation.y = s.wind > 0 ? 0 : Math.PI; flag.current.scale.x = 0.25 + Math.min(1, Math.abs(s.wind) / 2.5) * 0.9; flag.current.rotation.z = Math.sin(s.t * 12) * 0.08; }
    hud.current += dt;
    if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
  });

  return (
    <>
      <color attach="background" args={["#e9e1d4"]} />
      <hemisphereLight args={["#fff6e8", "#8a7560", 0.7]} />
      <directionalLight position={[3, 6, 3]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={2} position={[0, 4, 4]} scale={[8, 3, 1]} />
        <Lightformer intensity={1.2} position={[-5, 2, 0]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#ffe2c4" />
      </Environment>
      <Office />
      {/* desk you throw from */}
      <RoundedBox args={[1.2, 0.06, 0.45]} radius={0.02} position={[0, 0.98, 3.35]} castShadow receiveShadow><meshStandardMaterial map={deskWood} roughness={0.5} /></RoundedBox>
      {/* desk fan: blades spin with the wind, the ribbon shows which way it blows */}
      <group position={[-2.6, 0, -3]}>
        <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.28, 0.32, 0.05, 32]} /><meshStandardMaterial color="#2b2f36" metalness={0.6} roughness={0.35} /></mesh>
        <mesh position={[0, 0.8, 0]}><cylinderGeometry args={[0.025, 0.025, 1.6]} /><meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} /></mesh>
        <group position={[0, 1.6, 0]} rotation-y={Math.PI / 2}>
          <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.09, 0.11, 0.22, 20]} /><meshStandardMaterial color="#2b2f36" metalness={0.6} roughness={0.35} /></mesh>
          <mesh position={[0, 0, 0.16]}><torusGeometry args={[0.36, 0.012, 8, 48]} /><meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} /></mesh>
          <group ref={fanBlades} position={[0, 0, 0.16]}>
            {[0, 1, 2, 3].map((i) => (
              <group key={i} rotation-z={(i * Math.PI) / 2}>
                <mesh position={[0.17, 0, 0]} rotation-x={0.35}><boxGeometry args={[0.28, 0.12, 0.01]} /><meshStandardMaterial color="#4fc3ff" transparent opacity={0.85} side={THREE.DoubleSide} /></mesh>
              </group>
            ))}
            <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.05, 0.05, 0.06, 16]} /><meshStandardMaterial color="#e63946" /></mesh>
          </group>
        </group>
        <mesh ref={flag} position={[0, 1.95, 0]}><boxGeometry args={[0.6, 0.12, 0.01]} /><meshStandardMaterial color="#ff4fa3" side={THREE.DoubleSide} /></mesh>
      </group>
      {/* the bin: brushed metal, open top */}
      <group ref={bin}>
        <mesh position={[0, RIM_H / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[RIM_R, RIM_R * 0.82, RIM_H, 40, 1, true]} />
          <meshStandardMaterial color="#b9c2cc" metalness={0.55} roughness={0.35} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2}><circleGeometry args={[RIM_R * 0.82, 32]} /><meshStandardMaterial color="#6f7780" metalness={0.8} roughness={0.4} /></mesh>
        <mesh position={[0, RIM_H, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[RIM_R, 0.012, 12, 48]} /><meshStandardMaterial color="#d7dde3" metalness={1} roughness={0.2} /></mesh>
      </group>
      <ContactShadows position={[0, 0.005, 0]} opacity={0.45} scale={12} blur={2.2} far={3} />
      <mesh ref={ball} geometry={geo} castShadow>
        <meshStandardMaterial color="#f7f5ef" roughness={0.95} flatShading />
      </mesh>
      {Array.from({ length: DOTS }, (_, k) => (
        <mesh key={k} ref={(m) => { dots.current[k] = m; }} visible={false}><sphereGeometry args={[0.022, 10, 10]} /><meshBasicMaterial color="#ff4fa3" transparent opacity={0.85} /></mesh>
      ))}
      {sparks}
    </>
  );
}

export function PaperToss() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, left: BALLS, wind: 0, msg: "", msgT: 0, streak: 0 });
  const [best, setBest] = usePersistent("best3dToss", 0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [aiming, setAiming] = useState(false);
  const start = () => { st.current = fresh(); st.current.wind = (Math.random() - 0.5) * 0.6; setPhase("play"); };
  const end = () => { setPhase("over"); setBest((b) => Math.max(b, st.current.score)); };
  const aimFrom = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (d.y - e.clientY) / (r.height * 0.5)));
    const yaw = Math.max(-0.5, Math.min(0.5, ((e.clientX - d.x) / r.width) * 1.3));
    return { p, yaw };
  };
  const down = (e: React.PointerEvent) => {
    if (phase !== "play" || st.current.flying) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY }; st.current.aim = { p: 0, yaw: 0 }; setAiming(true);
  };
  const move = (e: React.PointerEvent) => { const a = aimFrom(e); if (a) st.current.aim = a; };
  const up = (e: React.PointerEvent) => {
    const a = aimFrom(e) ?? st.current.aim;
    drag.current = null; st.current.aim = null; setAiming(false);
    const s = st.current;
    if (!a || phase !== "play" || s.flying || a.p < 0.06) return;     // tiny drags cancel
    s.vel.copy(launch(a.p, a.yaw));
    s.flying = true; s.settle = 0;
    sfx("whoosh");
  };
  return (
    <GameFrame title="Paper Toss" emoji="🗑️" phase={phase} score={hud.score} best={best} onStart={start}
      extra={<>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">🧻 {hud.left}</span>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold backdrop-blur">💨 {hud.wind > 0.05 ? "→" : hud.wind < -0.05 ? "←" : "·"} {Math.abs(hud.wind).toFixed(1)}</span>
        {hud.msgT > 0 && <span className="rounded-xl border-2 border-white/30 bg-[#c6f24e] px-2 py-1 text-sm font-extrabold text-[#121212]">{hud.msg}</span>}
      </>}
      how={<>Press, drag up for power and sideways to aim, then let go. The dotted arc shows the throw without wind: watch the fan and aim into it. Swish (no rim) and long shots score bonuses. {BALLS} balls.</>}>
      <div className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing" onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={() => { drag.current = null; st.current.aim = null; setAiming(false); }}>
        <Canvas shadows camera={{ position: [0, 1.7, 4.2], fov: 50 }} dpr={[1, 1.75]} onCreated={({ camera }) => camera.lookAt(0, 0.5, -2)}>
          <Room st={st} phase={phase} onHud={(s) => setHud({ score: s.score, left: s.left, wind: s.wind, msg: s.msg, msgT: s.msgT, streak: s.streak })} onEnd={end} />
        </Canvas>
        {phase === "play" && !aiming && <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-xs font-bold text-white/90">drag up to aim · release to throw</div>}
      </div>
    </GameFrame>
  );
}
