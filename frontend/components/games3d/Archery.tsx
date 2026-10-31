"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop), never during render */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Cloud, Clouds, ContactShadows, Sky } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";

const G = 9.8, ARROWS = 10, EYE = new THREE.Vector3(0, 1.55, 0), FACE_R = 0.62;
const RINGS = ["#f5f2e8", "#f5f2e8", "#1b1b1f", "#1b1b1f", "#2e86de", "#2e86de", "#e63946", "#e63946", "#ffd23f", "#ffd23f"];
interface Shot { pos: THREE.Vector3; vel: THREE.Vector3; flying: boolean; stuck: boolean }
interface State {
  shots: Shot[]; aim: THREE.Vector3; drawing: boolean; draw: number; wind: number; dist: number;
  left: number; score: number; last: string; lastT: number; t: number; cam: number;
}
const fresh = (): State => ({ shots: [], aim: new THREE.Vector3(0, 0, -1), drawing: false, draw: 0, wind: 0, dist: 18,
  left: ARROWS, score: 0, last: "", lastT: 0, t: 0, cam: 0 });

function Arrow({ shot }: { shot: Shot }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    g.current.position.copy(shot.pos);
    if (shot.flying && shot.vel.lengthSq() > 0.01) g.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), shot.vel.clone().normalize());
  });
  return (
    <group ref={g}>
      <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.35]} castShadow><cylinderGeometry args={[0.006, 0.006, 0.7, 6]} /><meshStandardMaterial color="#8b5a2b" roughness={0.6} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -0.02]}><coneGeometry args={[0.014, 0.06, 8]} /><meshStandardMaterial color="#c9ced6" metalness={0.9} roughness={0.25} /></mesh>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[0, 0, 0.66]} rotation-z={(k * Math.PI * 2) / 3}><boxGeometry args={[0.002, 0.03, 0.09]} /><meshStandardMaterial color={k ? "#ff4fa3" : "#ffd23f"} /></mesh>
      ))}
    </group>
  );
}

function Range({ st, phase, onHud, onEnd }: { st: React.RefObject<State>; phase: Phase; onHud: (s: State) => void; onEnd: () => void }) {
  const target = useRef<THREE.Group>(null);
  const bow = useRef<THREE.Group>(null);
  const hud = useRef(0);
  const [, rerender] = useState(0);
  const { camera } = useThree();
  const [sparks, burst] = useSparks();
  const trees = useMemo(() => Array.from({ length: 26 }, () => {
    const side = Math.random() < 0.5 ? -1 : 1;
    return { x: side * (7 + Math.random() * 14), z: -8 - Math.random() * 40, s: 0.8 + Math.random() * 1.4 };
  }), []);

  const score = (s: State, hit: THREE.Vector3) => {
    const r = Math.hypot(hit.x, hit.y - 1.3);
    if (r > FACE_R) return 0;
    const ring = Math.min(9, Math.floor((r / FACE_R) * 10));
    return 10 - ring;
  };

  useFrame((_, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.033);
    s.t += dt;
    if (s.lastT > 0) s.lastT -= dt;
    if (s.drawing) s.draw = Math.min(1, s.draw + dt * 1.1);
    // camera follows the aim a little, and pushes in while drawing
    const look = EYE.clone().addScaledVector(s.aim, 10);
    camera.position.lerp(new THREE.Vector3(0, 1.6, 0.6 - s.draw * 0.25), 0.15);
    camera.lookAt(look.x * 0.35, 1.45 + (look.y - 1.45) * 0.35, -10);
    if (bow.current) {
      bow.current.position.set(0.22, 1.32, -0.15);
      bow.current.lookAt(look);
      bow.current.scale.z = 1 + s.draw * 0.06;
    }
    for (const sh of s.shots) {
      if (!sh.flying) continue;
      const steps = 6, h = dt / steps;
      for (let k = 0; k < steps; k++) {
        const prevZ = sh.pos.z;
        sh.vel.y -= G * h;
        sh.vel.x += s.wind * h;
        sh.pos.addScaledVector(sh.vel, h);
        // target face plane
        if (prevZ > -s.dist && sh.pos.z <= -s.dist) {
          const f = (prevZ + s.dist) / (prevZ - sh.pos.z);
          const hit = sh.pos.clone().addScaledVector(sh.vel, -h * (1 - f));
          if (Math.hypot(hit.x, hit.y - 1.3) < FACE_R * 1.08) {
            sh.pos.copy(hit).setZ(-s.dist + 0.04); sh.flying = false; sh.stuck = true;
            const pts = score(s, hit);
            s.score += pts;
            s.last = pts === 10 ? "Bullseye! +10" : pts ? `+${pts}` : "Edge";
            s.lastT = 1.4;
            sfx(pts >= 9 ? "combo" : pts ? "coin" : "tick");
            burst(hit.x, hit.y, -s.dist + 0.1, pts >= 9 ? "#ffd23f" : "#ffffff", pts >= 9 ? 50 : 18);
            break;
          }
        }
        if (sh.pos.y < 0.02) { sh.pos.y = 0.02; sh.flying = false; s.last = "Miss"; s.lastT = 1; sfx("wrong"); break; }
        if (sh.pos.z < -80) { sh.flying = false; break; }
      }
      if (!sh.flying) {
        s.left -= 1;
        if (s.left <= 0) setTimeout(onEnd, 900);
        else { s.wind = (Math.random() - 0.5) * (1 + (ARROWS - s.left) * 0.35); s.dist = 16 + Math.min(14, (ARROWS - s.left) * 1.4); }
      }
    }
    if (target.current) target.current.position.z += (-s.dist - target.current.position.z) * 0.08;
    hud.current += dt;
    if (hud.current > 0.08) { hud.current = 0; onHud({ ...s }); }
  });

  // the board / page asks to redraw arrows when a new one is nocked
  st.current.cam = st.current.shots.length;
  void rerender;

  return (
    <>
      <Sky sunPosition={[40, 18, -60]} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} />
      <Clouds limit={120}><Cloud seed={3} position={[-14, 16, -60]} bounds={[10, 2, 2]} volume={8} color="#ffffff" /><Cloud seed={7} position={[16, 18, -70]} bounds={[12, 2, 2]} volume={9} color="#f4f6ff" /></Clouds>
      <hemisphereLight args={["#dff1ff", "#5b7a3a", 0.9]} />
      <directionalLight position={[20, 25, 10]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-40} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -30]} receiveShadow><planeGeometry args={[120, 120]} /><meshStandardMaterial color="#6aa84f" roughness={1} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -15]} receiveShadow><planeGeometry args={[3, 34]} /><meshStandardMaterial color="#d9c49a" roughness={1} /></mesh>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position={[0, 0.8, 0]} castShadow><cylinderGeometry args={[0.12, 0.16, 1.6, 8]} /><meshStandardMaterial color="#6b4a2f" /></mesh>
          <mesh position={[0, 2.4, 0]} castShadow><coneGeometry args={[1, 2.6, 10]} /><meshStandardMaterial color={i % 3 ? "#2f6b3a" : "#3c7f45"} roughness={0.9} /></mesh>
        </group>
      ))}
      {/* target on a straw boss with an easel */}
      <group ref={target} position={[0, 0, -18]}>
        <mesh position={[0, 1.3, -0.12]} castShadow><cylinderGeometry args={[0.8, 0.8, 0.24, 40]} /><meshStandardMaterial color="#d8b25c" roughness={1} /></mesh>
        {RINGS.map((c, i) => (
          <mesh key={i} position={[0, 1.3, 0.001 * i + 0.002]}>
            <ringGeometry args={[FACE_R * (9 - i) / 10, FACE_R * (10 - i) / 10, 48]} /><meshStandardMaterial color={c} roughness={0.8} />
          </mesh>
        ))}
        {[-0.5, 0.5].map((x) => <mesh key={x} position={[x, 0.8, -0.3]} rotation-x={0.25} castShadow><boxGeometry args={[0.06, 1.8, 0.06]} /><meshStandardMaterial color="#6b4a2f" /></mesh>)}
      </group>
      {/* wind flag halfway down the range */}
      <WindFlag st={st} />
      {/* bow */}
      <group ref={bow}>
        <mesh rotation-y={Math.PI / 2}><torusGeometry args={[0.5, 0.012, 8, 40, Math.PI * 0.9]} /><meshStandardMaterial color="#2d2d33" metalness={0.4} roughness={0.4} /></mesh>
      </group>
      {st.current.shots.map((sh, i) => <Arrow key={i} shot={sh} />)}
      <ContactShadows position={[0, 0.01, -18]} opacity={0.35} scale={6} blur={2} far={2} />
      {sparks}
    </>
  );
}

function WindFlag({ st }: { st: React.RefObject<State> }) {
  const f = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = st.current;
    if (!f.current) return;
    f.current.rotation.y = s.wind >= 0 ? 0 : Math.PI;
    f.current.scale.x = 0.2 + Math.min(1, Math.abs(s.wind) / 3);
    f.current.rotation.z = Math.sin(s.t * 10) * 0.1;
  });
  return (
    <group position={[2.2, 0, -9]}>
      <mesh position={[0, 1.5, 0]} castShadow><cylinderGeometry args={[0.03, 0.03, 3]} /><meshStandardMaterial color="#ddd" metalness={0.7} roughness={0.3} /></mesh>
      <mesh ref={f} position={[0.4, 2.8, 0]}><boxGeometry args={[0.8, 0.35, 0.01]} /><meshStandardMaterial color="#ff4fa3" /></mesh>
    </group>
  );
}

export function Archery() {
  const st = useRef<State>(fresh());
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, left: ARROWS, wind: 0, dist: 18, draw: 0, last: "", lastT: 0 });
  const [best, setBest] = usePersistent("best3dArchery", 0);
  const [nocks, setNocks] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const start = () => { st.current = fresh(); st.current.wind = (Math.random() - 0.5) * 0.8; setNocks(0); setPhase("play"); };
  const end = () => { setPhase("over"); setBest((b) => Math.max(b, st.current.score)); };
  const aimAt = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    st.current.aim.set(nx * 0.32, ny * 0.22 + 0.02, -1).normalize();
  };
  const busy = () => st.current.shots.some((s) => s.flying);
  const down = (e: React.PointerEvent) => { aimAt(e); if (phase === "play" && !busy() && st.current.left > 0) { st.current.drawing = true; st.current.draw = 0; } };
  const up = () => {
    const s = st.current;
    if (!s.drawing) return;
    s.drawing = false;
    if (s.draw < 0.12) { s.draw = 0; return; }
    const speed = 22 + s.draw * 34;
    s.shots.push({ pos: new THREE.Vector3(0.22, 1.35, -0.4), vel: s.aim.clone().multiplyScalar(speed), flying: true, stuck: false });
    s.draw = 0;
    setNocks((n) => n + 1);
    sfx("whoosh");
  };
  return (
    <GameFrame title="Archery Range" emoji="🏹" phase={phase} score={hud.score} best={best} onStart={start}
      extra={<>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">🏹 {hud.left}</span>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold backdrop-blur">💨 {hud.wind > 0.05 ? "→" : hud.wind < -0.05 ? "←" : "·"} {Math.abs(hud.wind).toFixed(1)} · {Math.round(hud.dist)}m</span>
        {hud.lastT > 0 && <span className="rounded-xl border-2 border-white/30 bg-[#ffd23f] px-2 py-1 text-sm font-extrabold text-[#121212]">{hud.last}</span>}
      </>}
      how={<>Move to aim, press and hold to draw the bow, release to shoot. Arrows drop over distance and drift with the wind: aim above and into it. The target moves back as you go. {ARROWS} arrows.</>}>
      <div ref={box} className="absolute inset-0 cursor-crosshair touch-none" onPointerMove={aimAt} onPointerDown={down} onPointerUp={up} onPointerLeave={up}>
        <Canvas shadows camera={{ position: [0, 1.6, 0.6], fov: 55 }} dpr={[1, 1.75]}>
          <Range key={nocks >= 0 ? "r" : ""} st={st} phase={phase} onHud={(s) => setHud({ score: s.score, left: s.left, wind: s.wind, dist: s.dist, draw: s.draw, last: s.last, lastT: s.lastT })} onEnd={end} />
        </Canvas>
        {phase === "play" && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 w-48 -translate-x-1/2">
            <div className="h-2.5 overflow-hidden rounded-full border-2 border-white/40 bg-black/40"><div className="h-full bg-[linear-gradient(90deg,#c6f24e,#ffd23f,#ff4fa3)]" style={{ width: `${hud.draw * 100}%` }} /></div>
            <div className="mt-1 text-center text-[11px] font-bold text-white/80">{hud.draw > 0 ? "release to shoot" : "hold to draw"}</div>
          </div>
        )}
      </div>
    </GameFrame>
  );
}
