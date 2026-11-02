"use client";
/* eslint-disable react-hooks/immutability -- animation state lives in refs and is mutated per frame inside useFrame */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, Sky, useAnimations, useGLTF } from "@react-three/drei";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Cloud, Flowers, Hills, hash, lawnTexture, useTex, woodTexture } from "../games3d/scenery";

// A hidden treat on the team's founder card: a girl gallops in on her horse, leaps a fence and rides off into the sunset.
// Models: "Horse" and "Woman" by Quaternius, CC0 1.0 (see public/models/easter/CREDITS.txt).

const HORSE_URL = "/models/easter/horse.glb", RIDER_URL = "/models/easter/rider.glb";
const DURATION = 7.4;                  // seconds until the fade-out starts
const FENCE_X = 0.6, FENCE_Z = 1.9;
const HORSE_HEIGHT = 2.05, RIDER_HEIGHT = 1.62;   // metres, ears-to-hooves and head-to-toe

// Gallop path: in from the left, side-on past the camera and over the fence, then away into the sunset.
const PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-7.5, 0, 1.9), new THREE.Vector3(-3, 0, 1.9), new THREE.Vector3(FENCE_X, 0, FENCE_Z), new THREE.Vector3(4.2, 0, 1.4),
  new THREE.Vector3(6.4, 0, -2), new THREE.Vector3(7.8, 0, -11), new THREE.Vector3(8.4, 0, -30),
]);

/** Position along the path for time t: a steady gallop past the camera, then accelerating away. */
function progress(t: number) {
  const u = Math.min(1, Math.max(0, t / DURATION));
  return u < 0.58 ? 0.6 * u : 0.348 + (u - 0.58) * 1.55;
}

function fitHeight(obj: THREE.Object3D, height: number) {
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return height / (size.y || 1);
}

const SADDLE = 0.24;          // metres above the horse's spine bone where her hips sit
const FORWARD = 0.18;         // ...and this far towards the withers
const LEAN = 0.22;            // forward lean into the gallop (radians)
const STRADDLE = 0.62;        // how far her thighs open to sit astride (radians)

function HorseAndRider({ onDust }: { onDust: (x: number, z: number) => void }) {
  const horse = useGLTF(HORSE_URL), rider = useGLTF(RIDER_URL);
  const root = useRef<THREE.Group>(null), horseGroup = useRef<THREE.Group>(null), riderGroup = useRef<THREE.Group>(null);
  const { actions: hAct } = useAnimations(horse.animations, horseGroup);
  const { actions: rAct } = useAnimations(rider.animations, riderGroup);
  const hScale = useMemo(() => fitHeight(horse.scene, HORSE_HEIGHT), [horse.scene]);
  const rScale = useMemo(() => fitHeight(rider.scene, RIDER_HEIGHT), [rider.scene]);
  const back = useMemo(() => horse.scene.getObjectByName("Torso") ?? horse.scene.getObjectByName("Back") ?? horse.scene, [horse.scene]);
  const hips = useMemo(() => rider.scene.getObjectByName("Hips") ?? rider.scene, [rider.scene]);
  const thighs = useMemo(() => ["UpperLeg.L", "UpperLeg.R"].map((n) => rider.scene.getObjectByName(n)), [rider.scene]);
  const hipPos = useMemo(() => new THREE.Vector3(), []);
  const state = useRef({ t0: -1, jumped: false, lastStep: 0 });
  const p = useMemo(() => new THREE.Vector3(), []), ahead = useMemo(() => new THREE.Vector3(), []), bone = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(-3, 1.1, 1.9));

  useEffect(() => {
    for (const o of [horse.scene, rider.scene]) o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    });
    hAct.Gallop?.reset().setEffectiveTimeScale(1.15).play();
    Object.values(rAct)[0]?.reset().play();
  }, [hAct, rAct, horse.scene, rider.scene]);

  useFrame(({ clock }, dt) => {
    const s = state.current;
    if (s.t0 < 0) s.t0 = clock.elapsedTime;
    const t = clock.elapsedTime - s.t0;
    const k = Math.min(0.999, progress(t));
    PATH.getPointAt(k, p);
    PATH.getPointAt(Math.min(1, k + 0.006), ahead);
    if (root.current) {
      root.current.position.copy(p);
      const yaw = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
      root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, yaw, Math.min(1, dt * 6));
    }
    // leap the fence with the model's own jump animation, then fall back into the gallop
    const gallop = hAct.Gallop, jump = hAct.Gallop_Jump;
    if (!s.jumped && jump && gallop && p.x > FENCE_X - 1.9) {
      s.jumped = true;
      jump.reset().setLoop(THREE.LoopOnce, 1).setEffectiveTimeScale(1.1).crossFadeFrom(gallop, 0.15, false).play();
      window.setTimeout(() => { gallop.reset().crossFadeFrom(jump, 0.2, false).play(); }, (jump.getClip().duration / 1.1) * 1000 - 180);
    }
    // seat the rider: her hips go just above the horse's spine bone, so she rises and falls with every stride
    if (riderGroup.current && root.current) {
      thighs.forEach((leg, i) => { if (leg) leg.rotation.z += (i ? -1 : 1) * STRADDLE; });   // after the clip pose: sit astride
      const yaw = root.current.rotation.y;
      riderGroup.current.rotation.set(0, yaw + Math.PI / 2, 0);
      riderGroup.current.rotateX(LEAN);
      riderGroup.current.updateMatrixWorld(true);
      back.getWorldPosition(bone);
      bone.y += SADDLE; bone.x += Math.cos(yaw) * FORWARD; bone.z -= Math.sin(yaw) * FORWARD;
      hips.getWorldPosition(hipPos);
      riderGroup.current.position.add(bone.sub(hipPos));
    }
    // cinematic camera: pans to follow, then holds while they ride away
    lookTarget.set(THREE.MathUtils.clamp(p.x, -3.5, 4.5), 1.0, Math.max(p.z, -6));
    look.current.lerp(lookTarget, Math.min(1, dt * 2.5));
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, THREE.MathUtils.clamp(p.x * 0.45, -2.2, 2.6), Math.min(1, dt * 1.5));
    camera.lookAt(look.current);
    // a puff of dust every few strides
    if (clock.elapsedTime - s.lastStep > 0.22 && t < DURATION) { s.lastStep = clock.elapsedTime; onDust(p.x, p.z); }
  });

  return (
    <>
      <group ref={root}>
        <group ref={horseGroup} rotation-y={Math.PI / 2} scale={hScale}><primitive object={horse.scene} /></group>
      </group>
      <group ref={riderGroup} scale={rScale}><primitive object={rider.scene} /></group>
    </>
  );
}

const fenceWood = () => woodTexture("#9a6a3c");

function Fence() {
  const wood = useTex(fenceWood, 2, 1);
  return (
    <group position={[FENCE_X, 0, FENCE_Z]} rotation-y={Math.PI / 2}>
      {[-1.4, 0, 1.4].map((x) => (
        <mesh key={x} position={[x, 0.45, 0]} castShadow receiveShadow><boxGeometry args={[0.12, 0.9, 0.12]} /><meshStandardMaterial map={wood} roughness={0.8} /></mesh>
      ))}
      {[0.38, 0.72].map((y) => (
        <mesh key={y} position={[0, y, 0.07]} castShadow receiveShadow><boxGeometry args={[3.0, 0.09, 0.05]} /><meshStandardMaterial map={wood} roughness={0.8} /></mesh>
      ))}
    </group>
  );
}

/** Instanced grass blades around the path, swaying in the breeze. */
function Grass() {
  const N = 4200;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.ConeGeometry(0.022, 0.2, 3, 1);
    g.translate(0, 0.1, 0);
    return g;
  }, []);
  const blades = useMemo(() => Array.from({ length: N }, (_, i) => ({
    x: (hash(i, 1) - 0.5) * 26, z: -8 + hash(i, 2) * 12, s: 0.6 + hash(i, 3) * 0.9, r: hash(i, 4) * 6, lean: (hash(i, 5) - 0.5) * 0.4,
  })), []);
  const colors = useMemo(() => {
    const c = new Float32Array(N * 3), col = new THREE.Color();
    for (let i = 0; i < N; i++) { col.setHSL(0.25 + hash(i, 6) * 0.05, 0.5, 0.2 + hash(i, 7) * 0.1); c.set([col.r, col.g, col.b], i * 3); }
    return c;
  }, []);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    blades.forEach((b, i) => {
      o.position.set(b.x, 0, b.z);
      o.rotation.set(Math.sin(t * 1.6 + b.x * 0.6) * 0.12 + b.lean, b.r, 0);
      o.scale.set(1, b.s, 1);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[geo, undefined, N]} receiveShadow>
      <instancedBufferAttribute attach="instanceColor" args={[colors, 3]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  );
}

/** Dust kicked up by the hooves. */
function Dust({ api }: { api: React.RefObject<((x: number, z: number) => void) | null> }) {
  const N = 48;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const st = useRef({ x: new Float32Array(N), z: new Float32Array(N), life: new Float32Array(N), next: 0 });
  const o = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    api.current = (x, z) => {
      const s = st.current;
      for (let k = 0; k < 2; k++) {
        const i = s.next; s.next = (s.next + 1) % N;
        s.x[i] = x - 0.7 + (Math.random() - 0.5) * 0.5; s.z[i] = z + (Math.random() - 0.5) * 0.5; s.life[i] = 1;
      }
    };
  }, [api]);
  useFrame((_, dt) => {
    const s = st.current, m = mesh.current;
    if (!m) return;
    for (let i = 0; i < N; i++) {
      s.life[i] = Math.max(0, s.life[i] - dt * 1.1);
      const l = s.life[i];
      o.position.set(s.x[i], 0.06 + (1 - l) * 0.3, s.z[i]);
      o.scale.setScalar(l > 0 ? 0.05 + (1 - l) * 0.28 : 0);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, N]}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#e3cfa9" emissive="#a88a60" emissiveIntensity={0.3} transparent opacity={0.32} roughness={1} depthWrite={false} />
    </instancedMesh>
  );
}

function Scene() {
  const dust = useRef<((x: number, z: number) => void) | null>(null);
  const grass = useTex(lawnTexture, 40, 40);
  return (
    <>
      <Sky sunPosition={[30, 4, -60]} turbidity={7} rayleigh={2.6} mieCoefficient={0.012} mieDirectionalG={0.92} />
      <fog attach="fog" args={["#f2c79c", 16, 70]} />
      <hemisphereLight args={["#fff0dc", "#6b8a4a", 1.25]} />
      <directionalLight position={[10, 9, -4]} intensity={2.6} color="#ffcf95" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-far={40} />
      <directionalLight position={[-6, 5, 9]} intensity={1.3} color="#ffe9d0" />
      <Environment resolution={128} environmentIntensity={1.4}>
        <Lightformer intensity={1.4} color="#ffd9a8" position={[10, 4, -8]} scale={[10, 5, 1]} />
        <Lightformer intensity={0.5} color="#bcd7ff" position={[-8, 6, 6]} scale={[8, 4, 1]} />
      </Environment>
      <mesh rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[200, 200]} /><meshStandardMaterial map={grass} color="#b5cf8a" roughness={1} /></mesh>
      <Grass />
      <Hills radius={46} count={13} color="#6f9b4c" />
      <Flowers center={[-4.5, -1.5]} radius={1.6} count={70} seed={4} />
      <Flowers center={[4.6, -3.5]} radius={1.3} count={55} seed={9} />
      {[[-18, 10, -38, 3, 0.4], [16, 12, -46, 3.6, 0.3], [-2, 14, -52, 2.6, 0.35]].map(([x, y, z, sc, sp], i) => <Cloud key={i} position={[x, y, z]} scale={sc} speed={sp} span={110} />)}
      <Fence />
      <Suspense fallback={null}>
        <HorseAndRider onDust={(x, z) => dust.current?.(x, z)} />
      </Suspense>
      <Dust api={dust} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={30} blur={2.6} far={2.5} />
    </>
  );
}

/** Full-screen easter egg overlay; closes itself after the ride (or on click / Escape). */
export default function HorseRide({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOpen(false), DURATION * 1000 + 500);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", key); };
  }, []);
  return (
    <AnimatePresence onExitComplete={onDone}>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }}
          className="fixed inset-0 z-[100] cursor-pointer bg-[#f2c79c]" onClick={() => setOpen(false)} role="dialog" aria-label="Easter egg: a horse ride">
          <Canvas shadows camera={{ position: [0, 1.6, 7.2], fov: 40 }} dpr={[1, 1.75]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
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
