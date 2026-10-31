"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** Deterministic pseudo-random in [0,1) so layouts are stable between renders. */
export const hash = (i: number, k = 0) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

// ---------- procedural textures (drawn once on a canvas, cached) ----------

const texCache = new Map<string, THREE.CanvasTexture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, n: number) => void, color = true) {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function speckle(g: CanvasRenderingContext2D, n: number, count: number, colors: string[], size: [number, number], seed: number) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(hash(i, seed) * colors.length)];
    const w = size[0] + hash(i, seed + 1) * (size[1] - size[0]);
    g.fillRect(hash(i, seed + 2) * n, hash(i, seed + 3) * n, w, w * (1 + hash(i, seed + 4) * 2));
  }
}

/** Putting-green turf with mowing stripes (stripes run along the texture's v axis). */
export const grassTexture = (stripes = true) => canvasTex(`grass${stripes}`, 512, (g, n) => {
  g.fillStyle = "#3f9a46"; g.fillRect(0, 0, n, n);
  if (stripes) for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? "rgba(255,255,255,0.07)" : "rgba(0,40,0,0.06)"; g.fillRect(0, (i * n) / 4, n, n / 4); }
  speckle(g, n, 9000, ["#358a3d", "#4caf52", "#2f7f37", "#57b95c", "#3a9441"], [1, 2.2], 3);
});

/** Rougher lawn for the rough / surroundings. */
export const lawnTexture = () => canvasTex("lawn", 512, (g, n) => {
  g.fillStyle = "#6aa84a"; g.fillRect(0, 0, n, n);
  speckle(g, n, 12000, ["#5e9a40", "#78b955", "#4f8a36", "#86c25e", "#6fae4c"], [1.5, 3.5], 11);
});

export const sandTexture = () => canvasTex("sand", 256, (g, n) => {
  g.fillStyle = "#e8d29a"; g.fillRect(0, 0, n, n);
  speckle(g, n, 5000, ["#dcc286", "#f1dfae", "#cfb377", "#fff0c8"], [1, 2], 21);
});

/** Light wood with grain, for rails and buildings. */
export const woodTexture = (tone = "#b07a45") => canvasTex(`wood${tone}`, 256, (g, n) => {
  g.fillStyle = tone; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 70; i++) {
    const y = hash(i, 31) * n, a = 0.05 + hash(i, 32) * 0.12;
    g.strokeStyle = `rgba(60,30,10,${a})`; g.lineWidth = 1 + hash(i, 33) * 2.5;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
    g.stroke();
  }
});

export const stoneTexture = () => canvasTex("stone", 256, (g, n) => {
  g.fillStyle = "#9a958c"; g.fillRect(0, 0, n, n);
  speckle(g, n, 4000, ["#85807a", "#aaa59c", "#76716b", "#b8b3aa"], [2, 5], 41);
});

/** Ripples for water; scroll its offset each frame. */
export const waterTexture = () => canvasTex("water", 256, (g, n) => {
  const grd = g.createLinearGradient(0, 0, n, n); grd.addColorStop(0, "#1d8fd1"); grd.addColorStop(1, "#1677b8");
  g.fillStyle = grd; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.08 + hash(i, 51) * 0.18})`; g.lineWidth = 1.5;
    const x = hash(i, 52) * n, y = hash(i, 53) * n, w = 10 + hash(i, 54) * 30;
    g.beginPath(); g.ellipse(x, y, w, w * 0.25, 0, 0, Math.PI); g.stroke();
  }
});

/** A repeating copy of a cached texture (each user can set its own repeat). */
export function useTex(make: () => THREE.Texture, rx: number, ry: number) {
  return useMemo(() => {
    const t = make().clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }, [make, rx, ry]);
}

// ---------- scenery props ----------

export function Pine({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.35, 0]} castShadow><cylinderGeometry args={[0.08, 0.12, 0.7, 8]} /><meshStandardMaterial color="#6b4428" roughness={0.9} /></mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, 0.9 + i * 0.5, 0]} castShadow>
          <coneGeometry args={[0.75 - i * 0.18, 0.95, 9]} /><meshStandardMaterial color={["#2d6b3a", "#347a42", "#3d894a"][i]} roughness={0.85} flatShading />
        </mesh>
      ))}
    </group>
  );
}

export function RoundTree({ position, scale = 1, color = "#4f9a3c" }: { position: [number, number, number]; scale?: number; color?: string }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.09, 0.14, 1, 8]} /><meshStandardMaterial color="#7a5030" roughness={0.9} /></mesh>
      <mesh position={[0, 1.3, 0]} castShadow><icosahedronGeometry args={[0.7, 1]} /><meshStandardMaterial color={color} roughness={0.8} flatShading /></mesh>
      <mesh position={[0.35, 1.05, 0.2]} castShadow><icosahedronGeometry args={[0.45, 1]} /><meshStandardMaterial color={color} roughness={0.8} flatShading /></mesh>
      <mesh position={[-0.3, 1.1, -0.2]} castShadow><icosahedronGeometry args={[0.42, 1]} /><meshStandardMaterial color={color} roughness={0.8} flatShading /></mesh>
    </group>
  );
}

export function Rock({ position, scale = 1, seed = 0 }: { position: [number, number, number]; scale?: number; seed?: number }) {
  return (
    <mesh position={position} scale={[scale * (0.8 + hash(seed, 1) * 0.6), scale * (0.5 + hash(seed, 2) * 0.4), scale]} rotation-y={hash(seed, 3) * 6} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.3, 0]} /><meshStandardMaterial color="#8d8a84" roughness={0.95} flatShading />
    </mesh>
  );
}

/** A patch of little flowers (instanced). */
export function Flowers({ center, radius = 1, count = 40, seed = 0 }: { center: [number, number]; radius?: number; count?: number; seed?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const colors = useMemo(() => ["#ff6fa8", "#ffd23f", "#ffffff", "#b48cff", "#ff8a3d"].map((c) => new THREE.Color(c)), []);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    ref.current = m;
    const o = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = hash(i, seed) * Math.PI * 2, r = Math.sqrt(hash(i, seed + 1)) * radius;
      o.position.set(center[0] + Math.cos(a) * r, 0.05, center[1] + Math.sin(a) * r);
      o.scale.setScalar(0.6 + hash(i, seed + 2) * 0.7);
      o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, colors[i % colors.length]);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  return (
    <instancedMesh ref={setup} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.05, 6, 6]} /><meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}

/** Fluffy low-poly cloud drifting slowly. */
export function Cloud({ position, scale = 1, speed = 0.3, span = 60 }: { position: [number, number, number]; scale?: number; speed?: number; span?: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    g.current.position.x += speed * dt;
    if (g.current.position.x > span / 2) g.current.position.x = -span / 2;
  });
  return (
    <group ref={g} position={position} scale={scale}>
      {[[0, 0, 0, 1.2], [1.1, -0.2, 0.2, 0.9], [-1.1, -0.25, 0, 0.85], [0.4, 0.45, -0.2, 0.8], [-0.5, 0.3, 0.3, 0.7]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}><icosahedronGeometry args={[r, 1]} /><meshStandardMaterial color="#ffffff" roughness={1} flatShading /></mesh>
      ))}
    </group>
  );
}

/** Rolling hills on the horizon. */
export function Hills({ radius = 32, count = 9, color = "#6fae55" }: { radius?: number; count?: number; color?: string }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + hash(i, 61) * 0.4, r = radius + hash(i, 62) * 8, s = 6 + hash(i, 63) * 8;
        return (
          <mesh key={i} position={[Math.cos(a) * r, -s * 0.55, Math.sin(a) * r]} scale={[s * 1.6, s, s * 1.6]}>
            <sphereGeometry args={[1, 24, 16]} /><meshStandardMaterial color={color} roughness={1} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Trees, rocks and flowers scattered in a ring that leaves the play area clear. */
export function Woodland({ inner, outer, count = 40, seed = 0 }: { inner: number; outer: number; count?: number; seed?: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, i) => {
        const a = hash(i, seed + 71) * Math.PI * 2, r = inner + hash(i, seed + 72) * (outer - inner);
        const p: [number, number, number] = [Math.cos(a) * r, 0, Math.sin(a) * r], s = 0.7 + hash(i, seed + 73) * 0.8;
        const kind = hash(i, seed + 74);
        if (kind < 0.45) return <Pine key={i} position={p} scale={s * 1.2} />;
        if (kind < 0.8) return <RoundTree key={i} position={p} scale={s} color={["#4f9a3c", "#5aa845", "#3f8a35", "#76b04a"][i % 4]} />;
        return <Rock key={i} position={p} scale={s * 1.4} seed={i} />;
      })}
    </group>
  );
}
