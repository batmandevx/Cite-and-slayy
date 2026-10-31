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
      {/* floor: warm wooden boards */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[14, 16]} /><meshStandardMaterial color="#b98a5e" roughness={0.65} /></mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[-7 + i, 0.001, 0]}><planeGeometry args={[0.02, 16]} /><meshBasicMaterial color="#8d6440" /></mesh>
      ))}
      {/* back wall with window and a poster */}
      <mesh position={[0, 3, -6]} receiveShadow><planeGeometry args={[14, 6]} /><meshStandardMaterial color="#efe7da" /></mesh>
      <mesh position={[2.6, 2.4, -5.98]}><planeGeometry args={[2.2, 1.6]} /><meshStandardMaterial color="#bfe3ff" emissive="#bfe3ff" emissiveIntensity={0.6} /></mesh>
      <mesh position={[-2.4, 2.3, -5.98]}><planeGeometry args={[1.2, 1.6]} /><meshStandardMaterial color="#ff4fa3" /></mesh>
      {/* desk you throw from */}
      <RoundedBox args={[1.2, 0.06, 0.45]} radius={0.02} position={[0, 0.98, 3.35]} castShadow receiveShadow><meshStandardMaterial color="#6b4a2f" roughness={0.5} /></RoundedBox>
      {/* fan / wind flag */}
      <group position={[-2.6, 1.6, -3]}>
        <mesh position={[0, -0.8, 0]}><cylinderGeometry args={[0.02, 0.02, 1.6]} /><meshStandardMaterial color="#555" metalness={0.8} roughness={0.3} /></mesh>
        <mesh ref={flag} position={[0, 0, 0]}><boxGeometry args={[0.6, 0.3, 0.01]} /><meshStandardMaterial color="#ff4fa3" side={THREE.DoubleSide} /></mesh>
      </group>
      {/* the bin: brushed metal, open top */}
      <group ref={bin}>
        <mesh position={[0, RIM_H / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[RIM_R, RIM_R * 0.82, RIM_H, 40, 1, true]} />
          <meshStandardMaterial color="#9aa3ad" metalness={0.85} roughness={0.32} side={THREE.DoubleSide} />
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
