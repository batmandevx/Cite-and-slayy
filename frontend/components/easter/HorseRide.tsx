"use client";
/* eslint-disable react-hooks/immutability -- animation state lives in refs and is mutated per frame inside useFrame */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Cloud, Clouds, ContactShadows, Environment, Lightformer, Sky, Sparkles, useAnimations, useGLTF } from "@react-three/drei";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Volume2, VolumeX } from "lucide-react";
import { type RideSound, startRideSound } from "./rideSound";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Flowers, sandTexture, useTex, woodTexture } from "../games3d/scenery";
import { GrassField, heightAt, Pond, Ridge, setRoute, Terrain, Woods } from "./realScenery";

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

setRoute(PATH.getSpacedPoints(90));

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

// Her riding outfit (applied to the model's materials by name).
const OUTFIT: Record<string, string> = {
  Shirt: "#f7f1ea", Jacket: "#ff4f9a", LightJacket: "#ff8cc0", Pants: "#3d5f9e", Shoes: "#6b3f22",
  HairBase: "#3b2416", Hair: "#3b2416", Eyebrows: "#2a1a10",
};
const HAIR = "#3b2416";

/** Long hair and a swinging ponytail, built in her head's frame (+Z forward, +Y up). Returns the ponytail joints. */
function makeHair(): { group: THREE.Group; joints: THREE.Group[] } {
  const mat = new THREE.MeshStandardMaterial({ color: HAIR, roughness: 0.75 });
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], parent: THREE.Object3D = group) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...scale); m.castShadow = true; parent.add(m); return m;
  };
  add(new THREE.SphereGeometry(0.118, 24, 18), [0, 0.1, -0.012], [1.05, 0.98, 1.08]);           // crown
  add(new THREE.SphereGeometry(0.11, 20, 16), [0, -0.02, -0.07], [1.02, 1.55, 0.62]);          // long hair down her back
  for (const sx of [-1, 1]) add(new THREE.CapsuleGeometry(0.03, 0.14, 4, 10), [sx * 0.098, 0.0, 0.0]);   // strands framing her face
  add(new THREE.SphereGeometry(0.06, 16, 12), [0, 0.17, 0.065], [1.6, 0.55, 0.8]);             // fringe
  // ponytail: a chain of segments that streams back and bounces
  const joints: THREE.Group[] = [];
  let parent: THREE.Object3D = new THREE.Group();
  parent.position.set(0, 0.12, -0.12);
  group.add(parent);
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.011, 8, 18), new THREE.MeshStandardMaterial({ color: "#ff4f9a" }));
  tie.rotation.x = Math.PI / 2.4; parent.add(tie);
  for (let i = 0; i < 6; i++) {
    const j = new THREE.Group();
    j.position.set(0, i === 0 ? 0 : -0.07, 0);
    add(new THREE.CapsuleGeometry(0.042 - i * 0.005, 0.05, 4, 10), [0, -0.035, 0], [1, 1, 1], j);
    parent.add(j); joints.push(j); parent = j;
  }
  return { group, joints };
}

function HorseAndRider({ onDust, sound }: { onDust: (x: number, z: number) => void; sound: React.RefObject<RideSound | null> }) {
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
  const head = useMemo(() => rider.scene.getObjectByName("Head") ?? rider.scene, [rider.scene]);
  const hair = useMemo(() => makeHair(), []);
  const headPos = useMemo(() => new THREE.Vector3(), []), riderQ = useMemo(() => new THREE.Quaternion(), []);
  const state = useRef({ t0: -1, jumped: false, lastStep: 0 });
  const p = useMemo(() => new THREE.Vector3(), []), ahead = useMemo(() => new THREE.Vector3(), []), bone = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(-3, 1.1, 1.9));

  useEffect(() => {
    for (const o of [horse.scene, rider.scene]) o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    });
    // dress her for the ride
    rider.scene.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mt) => {
        const c = (mt as THREE.MeshStandardMaterial).clone();
        if (OUTFIT[c.name]) c.color.set(OUTFIT[c.name]);
        return c;
      }) as unknown as THREE.Material;
      if (Array.isArray(mesh.material) && mesh.material.length === 1) mesh.material = mesh.material[0];
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
      sound.current?.jump();
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
      // her hair follows her head; the ponytail streams back with the wind and bounces with each stride
      riderGroup.current.updateMatrixWorld(true);
      head.getWorldPosition(headPos);
      riderGroup.current.getWorldQuaternion(riderQ);
      hair.group.position.copy(headPos);
      hair.group.quaternion.copy(riderQ);
      const w = clock.elapsedTime * 13;
      hair.joints.forEach((j, i) => { j.rotation.x = -0.55 - i * 0.05 + Math.sin(w - i * 0.7) * 0.22; j.rotation.z = Math.sin(w * 0.5 - i) * 0.08; });
    }
    // cinematic camera: pans to follow, then holds while they ride away
    lookTarget.set(THREE.MathUtils.clamp(p.x, -3.5, 4.5), 1.0, Math.max(p.z, -6));
    look.current.lerp(lookTarget, Math.min(1, dt * 2.5));
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, THREE.MathUtils.clamp(p.x * 0.45, -2.2, 2.6), Math.min(1, dt * 1.5));
    camera.lookAt(look.current);
    // hooves get quieter as she rides away from the camera
    sound.current?.setDistance(Math.min(1, Math.hypot(p.x - camera.position.x, p.z - camera.position.z) / 30));
    // a puff of dust every few strides
    if (clock.elapsedTime - s.lastStep > 0.22 && t < DURATION) { s.lastStep = clock.elapsedTime; onDust(p.x, p.z); }
  });

  return (
    <>
      <group ref={root}>
        <group ref={horseGroup} rotation-y={Math.PI / 2} scale={hScale}><primitive object={horse.scene} /></group>
      </group>
      <group ref={riderGroup} scale={rScale}><primitive object={rider.scene} /></group>
      <primitive object={hair.group} />
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
      <meshStandardMaterial color="#e3cfa9" emissive="#a88a60" emissiveIntensity={0.3} transparent opacity={0.16} roughness={1} depthWrite={false} />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------- scenery

/** Soft round puff used as the cloud sprite (generated here, so nothing loads from another site). */
let puffUrl = "";
function cloudPuff() {
  if (puffUrl || typeof document === "undefined") return puffUrl;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.55, "rgba(255,255,255,0.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  puffUrl = c.toDataURL();
  return puffUrl;
}

function SoftClouds() {
  const tex = useMemo(() => cloudPuff(), []);
  return (
    <Clouds material={THREE.MeshLambertMaterial} texture={tex} limit={260}>
      <Cloud seed={1} segments={28} bounds={[14, 2.5, 3]} volume={10} color="#ffe6d0" position={[-22, 15, -55]} speed={0.15} opacity={0.85} />
      <Cloud seed={2} segments={24} bounds={[12, 2, 3]} volume={9} color="#ffd8c0" position={[20, 18, -62]} speed={0.12} opacity={0.8} />
      <Cloud seed={3} segments={18} bounds={[9, 1.6, 2]} volume={6} color="#fff0e2" position={[0, 22, -70]} speed={0.1} opacity={0.7} />
    </Clouds>
  );
}



/** A dirt riding trail following their route. */
function Trail() {
  const dirt = useTex(sandTexture, 1, 30);
  const geo = useMemo(() => {
    const n = 140, w = 1.5, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const p = new THREE.Vector3(), tng = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      PATH.getPointAt(u, p); PATH.getTangentAt(u, tng);
      const nx = -tng.z, nz = tng.x, len = Math.hypot(nx, nz) || 1, ww = w * (1 - u * 0.5);
      pos.push(p.x + (nx / len) * ww / 2, 0.012, p.z + (nz / len) * ww / 2, p.x - (nx / len) * ww / 2, 0.012, p.z - (nz / len) * ww / 2);
      uv.push(0, u, 1, u);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo} receiveShadow><meshStandardMaterial map={dirt} color="#b08a5e" roughness={1} polygonOffset polygonOffsetFactor={-2} /></mesh>;
}

/** A post-and-rail fence running alongside the trail. */
function FenceLine() {
  const wood = useTex(fenceWood, 6, 1);
  return (
    <group position={[0, 0, -1.4]}>
      {Array.from({ length: 13 }, (_, i) => (
        <mesh key={i} position={[-12 + i * 2, heightAt(-12 + i * 2, -1.4) + 0.5, 0]} castShadow><boxGeometry args={[0.1, 1, 0.1]} /><meshStandardMaterial map={wood} roughness={0.85} /></mesh>
      ))}
      {[0.45, 0.82].map((y) => (
        <mesh key={y} position={[0, y, 0.05]} castShadow><boxGeometry args={[24, 0.08, 0.05]} /><meshStandardMaterial map={wood} roughness={0.85} /></mesh>
      ))}
    </group>
  );
}

/** A little red barn on the far side of the meadow. */
function Barn() {
  const roof = useMemo(() => {
    const sh = new THREE.Shape(); sh.moveTo(-2.4, 0); sh.lineTo(0, 1.7); sh.lineTo(2.4, 0); sh.lineTo(-2.4, 0);
    return new THREE.ExtrudeGeometry(sh, { depth: 5.4, bevelEnabled: false });
  }, []);
  return (
    <group position={[-17, heightAt(-17, -19), -19]} rotation-y={0.5}>
      <mesh position={[0, 0.5, 0]} receiveShadow><boxGeometry args={[4.6, 5, 5.2]} /><meshStandardMaterial color="#6d6457" roughness={1} /></mesh>
      <mesh position={[0, 1.5, 0]} castShadow receiveShadow><boxGeometry args={[4.4, 3, 5]} /><meshStandardMaterial color="#b3342b" roughness={0.8} /></mesh>
      <mesh geometry={roof} position={[0, 3, -2.7]} castShadow><meshStandardMaterial color="#4a3a33" roughness={0.7} /></mesh>
      <mesh position={[0, 1.1, 2.51]}><planeGeometry args={[1.8, 2.2]} /><meshStandardMaterial color="#f4ece0" /></mesh>
      <mesh position={[0, 1.1, 2.52]}><planeGeometry args={[1.5, 1.9]} /><meshStandardMaterial color="#8f2a22" /></mesh>
      <mesh position={[0, 2.5, 2.51]}><planeGeometry args={[0.7, 0.5]} /><meshStandardMaterial color="#f4ece0" /></mesh>
    </group>
  );
}

/** A small flock gliding across the evening sky. */
function Birds() {
  const g = useRef<THREE.Group>(null);
  const wings = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (g.current) g.current.position.set(-30 + t * 4.2, 13 + Math.sin(t * 0.6) * 0.6, -34);
    wings.current.forEach((w, i) => { if (w) w.rotation.z = Math.sin(t * 9 + i) * 0.55; });
  });
  return (
    <group ref={g}>
      {[[0, 0, 0], [-1.6, -0.6, 0.5], [-1.4, 0.7, -0.4], [-3, -1.1, 0.8], [-3.2, 1.2, -0.6]].map((p, i) => (
        <group key={i} position={p as [number, number, number]}>
          {[-1, 1].map((sx) => (
            <group key={sx} ref={(el) => { wings.current[i * 2 + (sx > 0 ? 1 : 0)] = el; }} scale={[sx, 1, 1]}>
              <mesh position={[0.25, 0, 0]} rotation-z={-0.2}><boxGeometry args={[0.5, 0.03, 0.12]} /><meshBasicMaterial color="#3b2d2a" /></mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

function Scene({ sound }: { sound: React.RefObject<RideSound | null> }) {
  const dust = useRef<((x: number, z: number) => void) | null>(null);
  return (
    <>
      <Sky sunPosition={[30, 4, -60]} turbidity={7} rayleigh={2.6} mieCoefficient={0.012} mieDirectionalG={0.92} />
      <fog attach="fog" args={["#efc7a0", 30, 190]} />
      <hemisphereLight args={["#fff0dc", "#7d9a5a", 1.6]} />
      <directionalLight position={[10, 9, -4]} intensity={3.4} color="#ffcf95" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-far={40} />
      <directionalLight position={[-6, 5, 9]} intensity={1.3} color="#ffe9d0" />
      <Environment resolution={128} environmentIntensity={1.4}>
        <Lightformer intensity={1.4} color="#ffd9a8" position={[10, 4, -8]} scale={[10, 5, 1]} />
        <Lightformer intensity={0.5} color="#bcd7ff" position={[-8, 6, 6]} scale={[8, 4, 1]} />
      </Environment>
      <Terrain />
      <GrassField />
      <Pond />
      <Flowers center={[-4.5, -1.5]} radius={1.6} count={70} seed={4} />
      <Flowers center={[4.6, -3.5]} radius={1.3} count={55} seed={9} />
      <SoftClouds />
      <Ridge />
      <Woods />
      <Barn />
      <Birds />
      <Trail />
      <FenceLine />
      <Sparkles count={70} scale={[16, 4, 8]} position={[0, 2, 0]} size={2.2} speed={0.25} color="#fff2c8" opacity={0.7} />
      <Fence />
      <Suspense fallback={null}>
        <HorseAndRider onDust={(x, z) => dust.current?.(x, z)} sound={sound} />
      </Suspense>
      <Dust api={dust} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={30} blur={2.6} far={2.5} />
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.9} intensity={1.1} distanceFalloff={1} quality="medium" />
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.82} luminanceSmoothing={0.2} />
        <Vignette eskil={false} offset={0.3} darkness={0.32} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

/** Full-screen easter egg overlay; closes itself after the ride (or on click / Escape). */
export default function HorseRide({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const [muted, setMuted] = useState(false);
  const sound = useRef<RideSound | null>(null);
  useEffect(() => {
    sound.current = startRideSound();
    return () => { sound.current?.stop(); sound.current = null; };
  }, []);
  useEffect(() => { if (!open) sound.current?.stop(); }, [open]);
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
          <Canvas shadows camera={{ position: [0, 1.6, 7.2], fov: 40, far: 400 }} dpr={[1, 1.5]} gl={{ antialias: false, toneMapping: THREE.NoToneMapping }}>
            <Scene sound={sound} />
          </Canvas>
          <motion.div initial={{ y: -30, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: -3 }} transition={{ delay: 0.5, type: "spring", stiffness: 220, damping: 16 }}
            className="sticker pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 bg-yellow text-lg">
            🐎 Giddy up!
          </motion.div>
          <button onClick={(e) => { e.stopPropagation(); if (muted) { sound.current = startRideSound(); setMuted(false); } else { sound.current?.stop(); sound.current = null; setMuted(true); } }}
            aria-label={muted ? "Sound on" : "Mute"} className="btn-brut absolute right-5 top-6 grid size-10 place-items-center rounded-xl bg-surface text-ink">
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <div className="pointer-events-none absolute bottom-5 inset-x-0 text-center text-xs font-bold text-[#121212]/60">You found a secret · click to close</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
