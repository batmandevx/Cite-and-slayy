"use client";
/* eslint-disable react-hooks/immutability -- animation state lives in refs and is mutated per frame inside useFrame */

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Sky } from "@react-three/drei";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Cloud, Flowers, Hills, lawnTexture, useTex } from "../games3d/scenery";

// A hidden treat on the team's founder card: a girl gallops past on a horse and rides off into the sunset.

const DURATION = 6.2;          // seconds
const STRIDE = Math.PI * 2 * 2.1;  // gallop rate (rad/s)

const COAT = "#8a5528", DARK = "#2a1810", HOOF = "#1d1612", SKIN = "#f1c7a3", HAIR = "#2b1810", JACKET = "#ff4fa3", JEANS = "#2f4f8f";

function std(color: string, rough = 0.6, metal = 0) {
  return <meshStandardMaterial color={color} roughness={rough} metalness={metal} />;
}

/** One leg: hip/shoulder joint, upper leg, knee/hock joint, cannon, hoof. Rotations are set every frame. */
function Leg({ setHip, setKnee, x, z }: { setHip: (g: THREE.Group | null) => void; setKnee: (g: THREE.Group | null) => void; x: number; z: number }) {
  return (
    <group ref={setHip} position={[x, -0.18, z]}>
      <mesh position={[0, -0.08, 0]} scale={[1, 1.3, 1]} castShadow><sphereGeometry args={[0.13, 14, 12]} />{std(COAT, 0.55)}</mesh>
      <mesh position={[0, -0.22, 0]} castShadow><capsuleGeometry args={[0.085, 0.32, 6, 12]} />{std(COAT)}</mesh>
      <group ref={setKnee} position={[0, -0.46, 0]}>
        <mesh position={[0, -0.23, 0]} castShadow><capsuleGeometry args={[0.045, 0.38, 6, 10]} />{std(COAT)}</mesh>
        <mesh position={[0, -0.45, 0]} castShadow><cylinderGeometry args={[0.06, 0.07, 0.09, 12]} />{std(HOOF, 0.4)}</mesh>
        {/* white sock */}
        <mesh position={[0, -0.36, 0]}><cylinderGeometry args={[0.052, 0.056, 0.1, 12]} />{std("#f3ede2", 0.8)}</mesh>
      </group>
    </group>
  );
}

function HorseAndRider({ t0, onDust }: { t0: React.RefObject<number>; onDust: (x: number, z: number) => void }) {
  const root = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), neck = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null);
  const hips = useRef<(THREE.Group | null)[]>([]), knees = useRef<(THREE.Group | null)[]>([]);
  const mane = useRef<(THREE.Object3D | null)[]>([]), tail = useRef<(THREE.Group | null)[]>([]), pony = useRef<(THREE.Group | null)[]>([]);
  const torso = useRef<THREE.Group>(null);
  const lastStep = useRef(0);
  // legs: front-left, front-right, hind-left, hind-right (phase offsets give a rotary gallop)
  const LEGS = useMemo(() => [
    { x: 0.42, z: 0.15, phase: 0.0, front: true }, { x: 0.42, z: -0.15, phase: 0.55, front: true },
    { x: -0.5, z: 0.15, phase: 2.6, front: false }, { x: -0.5, z: -0.15, phase: 3.15, front: false },
  ], []);
  const path = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.2, 0, 1.6), new THREE.Vector3(-3, 0, 1.8), new THREE.Vector3(0, 0, 1.8), new THREE.Vector3(3.2, 0, 1.4),
    new THREE.Vector3(5.6, 0, -1.5), new THREE.Vector3(7, 0, -9), new THREE.Vector3(7.6, 0, -26),
  ]), []);
  const tmp = useMemo(() => new THREE.Vector3(), []), ahead = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime - (t0.current ?? 0);
    const w = t * STRIDE;
    // move along the path, easing in, then accelerating away into the distance
    const u = Math.min(1, Math.max(0, t / DURATION));
    const s = u < 0.55 ? 0.62 * u : 0.341 + (u - 0.55) * 1.46;   // slow side-on pass, then gallop away
    path.getPointAt(Math.min(0.999, s), tmp);
    path.getPointAt(Math.min(1, s + 0.01), ahead);
    if (root.current) {
      root.current.position.copy(tmp);
      root.current.rotation.y = Math.atan2(-(ahead.z - tmp.z), ahead.x - tmp.x);
    }
    // body: rocking canter motion
    if (body.current) {
      body.current.position.y = 1.32 + Math.sin(w * 2) * 0.05 + Math.max(0, Math.sin(w)) * 0.06;
      body.current.rotation.z = Math.sin(w + 0.6) * 0.07;
    }
    if (neck.current) neck.current.rotation.z = -0.95 + Math.sin(w + 1.2) * 0.1;   // neck reaches forward, head points down
    if (head.current) head.current.rotation.z = -1.2 - Math.sin(w + 1.2) * 0.08;
    LEGS.forEach((L, i) => {
      const a = w + L.phase, sw = Math.sin(a), bend = Math.max(0, Math.cos(a));
      if (hips.current[i]) hips.current[i]!.rotation.z = (L.front ? 0.6 : 0.52) * sw + (L.front ? 0.05 : -0.08);
      if (knees.current[i]) knees.current[i]!.rotation.z = L.front ? -1.15 * bend : 0.85 * bend;
    });
    mane.current.forEach((m, i) => { if (m) m.rotation.x = Math.sin(w * 1.3 + i * 0.7) * 0.35; });
    tail.current.forEach((g, i) => { if (g) { g.rotation.z = -0.18 + Math.sin(w + i * 0.6) * 0.16; g.rotation.y = Math.sin(w * 0.7 + i) * 0.12; } });
    pony.current.forEach((g, i) => { if (g) g.rotation.z = 0.35 + Math.sin(w * 1.4 + i * 0.8) * 0.28; });
    if (torso.current) torso.current.rotation.z = -0.32 - Math.sin(w * 2 + 0.5) * 0.06;
    // dust at each stride
    if (w - lastStep.current > Math.PI && t < DURATION) { lastStep.current = w; onDust(tmp.x, tmp.z); }
  });

  return (
    <group ref={root}>
      <group ref={body}>
        {/* barrel, chest and rump */}
        <mesh rotation-z={Math.PI / 2} castShadow><capsuleGeometry args={[0.31, 0.95, 10, 24]} />{std(COAT, 0.55)}</mesh>
        <mesh position={[0.52, 0.02, 0]} castShadow><sphereGeometry args={[0.33, 24, 18]} />{std(COAT, 0.55)}</mesh>
        <mesh position={[-0.55, 0.06, 0]} castShadow><sphereGeometry args={[0.35, 24, 18]} />{std(COAT, 0.55)}</mesh>
        {/* saddle and blanket */}
        <mesh position={[0.02, 0.27, 0]}><boxGeometry args={[0.5, 0.06, 0.62]} />{std("#4dc3ff", 0.8)}</mesh>
        <mesh position={[0.02, 0.33, 0]} castShadow><boxGeometry args={[0.36, 0.08, 0.4]} />{std("#5b3218", 0.45)}</mesh>
        {LEGS.map((L, i) => <Leg key={i} x={L.x} z={L.z} setHip={(g) => { hips.current[i] = g; }} setKnee={(g) => { knees.current[i] = g; }} />)}

        {/* neck, mane, head */}
        <group ref={neck} position={[0.66, 0.14, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow><cylinderGeometry args={[0.15, 0.25, 0.66, 18]} />{std(COAT, 0.55)}</mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} ref={(m) => { mane.current[i] = m; }} position={[-0.15, 0.04 + i * 0.09, 0]} castShadow>
              <boxGeometry args={[0.1, 0.11, 0.06]} />{std(DARK, 0.9)}
            </mesh>
          ))}
          <group ref={head} position={[0, 0.62, 0]}>
            <mesh position={[0, 0.2, 0]} castShadow><capsuleGeometry args={[0.135, 0.32, 8, 16]} />{std(COAT, 0.55)}</mesh>
            <mesh position={[0.02, 0.45, 0]} castShadow><sphereGeometry args={[0.12, 16, 12]} />{std("#6e4220", 0.6)}</mesh>
            <mesh position={[0.1, 0.24, 0]}><boxGeometry args={[0.02, 0.18, 0.05]} />{std("#f3ede2", 0.8)}</mesh>
            {[-1, 1].map((sz) => (
              <group key={sz}>
                <mesh position={[-0.05, 0.02, sz * 0.07]} rotation-z={Math.PI / 2}><coneGeometry args={[0.035, 0.12, 8]} />{std(COAT)}</mesh>
                <mesh position={[0.05, 0.14, sz * 0.11]}><sphereGeometry args={[0.022, 10, 8]} />{std("#111", 0.2)}</mesh>
              </group>
            ))}
          </group>
        </group>

        {/* tail: a chain of segments that whips as she runs */}
        <group position={[-0.86, 0.22, 0]} rotation-z={-1.05}>
          {(() => {
            const seg = (i: number): React.ReactNode => i >= 5 ? null : (
              <group ref={(g) => { tail.current[i] = g; }} position={[0, i === 0 ? 0 : -0.17, 0]}>
                <mesh position={[0, -0.085, 0]} castShadow><capsuleGeometry args={[0.07 - i * 0.008, 0.13, 4, 8]} />{std(DARK, 0.9)}</mesh>
                {seg(i + 1)}
              </group>
            );
            return seg(0);
          })()}
        </group>

        {/* the rider */}
        <group position={[0.02, 0.38, 0]}>
          {/* legs astride the saddle */}
          {[-1, 1].map((sz) => (
            <group key={sz} position={[0.02, 0.02, sz * 0.2]}>
              <mesh position={[0.1, -0.02, sz * 0.07]} rotation={[sz * 0.3, 0, -1.2]} castShadow><capsuleGeometry args={[0.065, 0.24, 6, 10]} />{std(JEANS, 0.7)}</mesh>
              <mesh position={[0.18, -0.25, sz * 0.13]} rotation-x={sz * 0.1} castShadow><capsuleGeometry args={[0.05, 0.26, 6, 10]} />{std(JEANS, 0.7)}</mesh>
              <mesh position={[0.22, -0.43, sz * 0.13]} castShadow><boxGeometry args={[0.16, 0.06, 0.08]} />{std("#3a2414", 0.5)}</mesh>
            </group>
          ))}
          <group ref={torso} position={[0, 0.05, 0]}>
            <mesh position={[0, 0.25, 0]} castShadow><capsuleGeometry args={[0.13, 0.26, 8, 14]} />{std(JACKET, 0.6)}</mesh>
            {/* arms reaching for the reins */}
            {[-1, 1].map((sz) => (
              <mesh key={sz} position={[0.16, 0.3, sz * 0.14]} rotation={[0, 0, -1.05]} castShadow><capsuleGeometry args={[0.04, 0.3, 6, 10]} />{std(JACKET, 0.6)}</mesh>
            ))}
            <mesh position={[0.3, 0.2, 0]}><sphereGeometry args={[0.05, 10, 8]} />{std(SKIN, 0.6)}</mesh>
            {/* head, hair and a bouncing ponytail */}
            <mesh position={[0.02, 0.56, 0]} castShadow><sphereGeometry args={[0.11, 20, 16]} />{std(SKIN, 0.55)}</mesh>
            <mesh position={[-0.01, 0.6, 0]} scale={[1.08, 0.9, 1.08]}><sphereGeometry args={[0.11, 20, 16, 0, Math.PI * 2, 0, Math.PI / 1.8]} />{std(HAIR, 0.85)}</mesh>
            <mesh position={[0.11, 0.56, 0.04]}><sphereGeometry args={[0.014, 8, 6]} />{std("#111", 0.2)}</mesh>
            <mesh position={[0.11, 0.56, -0.04]}><sphereGeometry args={[0.014, 8, 6]} />{std("#111", 0.2)}</mesh>
            <group position={[-0.1, 0.62, 0]}>
              {(() => {
                const seg = (i: number): React.ReactNode => i >= 4 ? null : (
                  <group ref={(g) => { pony.current[i] = g; }} position={[i === 0 ? 0 : -0.08, 0, 0]}>
                    <mesh position={[-0.04, 0, 0]} rotation-z={Math.PI / 2} castShadow><capsuleGeometry args={[0.035 - i * 0.005, 0.06, 4, 8]} />{std(HAIR, 0.85)}</mesh>
                    {seg(i + 1)}
                  </group>
                );
                return seg(0);
              })()}
            </group>
            <mesh position={[-0.08, 0.63, 0]}><torusGeometry args={[0.03, 0.012, 8, 16]} />{std("#ffd23f", 0.4)}</mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Dust puffs kicked up by the hooves. */
function Dust({ api }: { api: React.RefObject<((x: number, z: number) => void) | null> }) {
  const N = 40;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const state = useRef({ x: new Float32Array(N), z: new Float32Array(N), life: new Float32Array(N), next: 0 });
  const o = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    api.current = (x, z) => {
      const s = state.current;
      for (let k = 0; k < 3; k++) {
        const i = s.next; s.next = (s.next + 1) % N;
        s.x[i] = x - 0.6 + (Math.random() - 0.5) * 0.4; s.z[i] = z + (Math.random() - 0.5) * 0.5; s.life[i] = 1;
      }
    };
  }, [api]);
  useFrame((_, dt) => {
    const s = state.current, m = mesh.current;
    if (!m) return;
    for (let i = 0; i < N; i++) {
      s.life[i] = Math.max(0, s.life[i] - dt * 1.3);
      const l = s.life[i];
      o.position.set(s.x[i], 0.06 + (1 - l) * 0.18, s.z[i]);
      o.scale.setScalar(l > 0 ? 0.03 + (1 - l) * 0.12 : 0);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#e8d3b0" emissive="#b89a70" emissiveIntensity={0.35} transparent opacity={0.4} roughness={1} depthWrite={false} />
    </instancedMesh>
  );
}

function Scene() {
  const t0 = useRef<number>(0);
  const dust = useRef<((x: number, z: number) => void) | null>(null);
  const grass = useTex(lawnTexture, 40, 40);
  useFrame(({ clock }) => { if (!t0.current) t0.current = clock.elapsedTime; });
  return (
    <>
      <Sky sunPosition={[20, 3.5, -40]} turbidity={6} rayleigh={2.2} mieCoefficient={0.01} mieDirectionalG={0.9} />
      <fog attach="fog" args={["#f6c99a", 18, 60]} />
      <hemisphereLight args={["#ffe2c2", "#4d6b35", 0.9]} />
      <directionalLight position={[8, 10, 6]} intensity={2.4} color="#ffd9a8" castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={10} shadow-camera-bottom={-10} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[160, 160]} /><meshStandardMaterial map={grass} roughness={1} /></mesh>
      <Hills radius={42} count={12} color="#6f9b4c" />
      <Flowers center={[-3, 3.2]} radius={1.6} count={70} seed={4} />
      <Flowers center={[4.5, 2.6]} radius={1.2} count={50} seed={9} />
      {[[-18, 10, -36, 3, 0.4], [14, 12, -42, 3.5, 0.3]].map(([x, y, z, sc, sp], i) => <Cloud key={i} position={[x, y, z]} scale={sc} speed={sp} span={100} />)}
      <HorseAndRider t0={t0} onDust={(x, z) => dust.current?.(x, z)} />
      <Dust api={dust} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={30} blur={2.4} far={2} />
    </>
  );
}

/** Full-screen easter egg overlay; closes itself after the ride (or on click / Escape). */
export default function HorseRide({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOpen(false), DURATION * 1000 + 400);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", key); };
  }, []);
  return (
    <AnimatePresence onExitComplete={onDone}>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}
          className="fixed inset-0 z-[100] cursor-pointer bg-[#f6c99a]" onClick={() => setOpen(false)} role="dialog" aria-label="Easter egg: a horse ride">
          <Canvas shadows camera={{ position: [0, 1.7, 6.6], fov: 42 }} dpr={[1, 1.75]} onCreated={({ camera }) => camera.lookAt(0.4, 1.1, 0)}>
            <Scene />
          </Canvas>
          <motion.div initial={{ y: -30, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: -3 }} transition={{ delay: 0.5, type: "spring", stiffness: 220, damping: 16 }}
            className="sticker pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 bg-yellow text-lg">
            🐎 Giddy up!
          </motion.div>
          <div className="pointer-events-none absolute bottom-5 inset-x-0 text-center text-xs font-bold text-[#121212]/60">You found a secret · click to close</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
