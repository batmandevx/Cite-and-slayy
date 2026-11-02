"use client";
/* eslint-disable react-hooks/immutability -- shader uniforms are updated per frame inside useFrame */

import { useFrame } from "@react-three/fiber";
import { MeshReflectorMaterial } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { hash, lawnTexture, useTex } from "../games3d/scenery";

// Procedural, more realistic landscape for the horse-ride easter egg: noise terrain, a snowy ridgeline,
// smooth-canopied trees, a wind-blown grass field and a reflective pond. Nothing is downloaded.

// ---------------------------------------------------------------- noise

function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Keep-flat zones: the riding route and the pond. Points sampled once from the route.
let route: [number, number][] = [];
export function setRoute(points: THREE.Vector3[]) { route = points.map((p) => [p.x, p.z]); }
export const POND = { x: -8.5, z: -4.2, rx: 3.2, rz: 1.6 };

function routeDistance(x: number, z: number) {
  let d = 1e9;
  for (const [px, pz] of route) d = Math.min(d, (x - px) ** 2 + (z - pz) ** 2);
  return Math.sqrt(d);
}

/** Ground height at (x, z). The meadow near the route stays almost flat; the land rolls into hills behind. */
export function heightAt(x: number, z: number) {
  const roll = (fbm(x * 0.045 + 3.1, z * 0.045 - 1.7) - 0.5) * 1.6;                 // gentle undulation
  const back = smooth(-16, -70, z) * (2.5 + fbm(x * 0.03, z * 0.03 + 9) * 5);         // low hills rolling away behind the meadow
  const sides = smooth(20, 40, Math.abs(x)) * (3 + fbm(x * 0.05, z * 0.05) * 5);
  const flat = Math.max(Math.exp(-((routeDistance(x, z) / 5) ** 2)), Math.exp(-(((x - POND.x) / (POND.rx + 2)) ** 2 + ((z - POND.z) / (POND.rz + 2)) ** 2)));
  const near = smooth(-4, 8, z);                                                       // foreground stays calm
  return (roll * (1 - near * 0.7) + back + sides) * (1 - flat) - (Math.exp(-(((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2)) * 0.25);
}

// ---------------------------------------------------------------- terrain

export function Terrain() {
  const detail = useTex(lawnTexture, 22, 22);   // coarse repeat: fine speckle shimmers as the camera pans
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(200, 200, 230, 230);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3), c = new THREE.Color(), dry = new THREE.Color("#b9a25a"), lush = new THREE.Color("#3f7a2c"), deep = new THREE.Color("#2c5a22");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = heightAt(x, z);
      p.setY(i, y);
      const n = fbm(x * 0.08, z * 0.08, 4);
      c.copy(lush).lerp(deep, smooth(0.35, 0.7, n)).lerp(dry, smooth(0.55, 0.85, fbm(x * 0.02 + 5, z * 0.02, 3)) * 0.55);
      c.multiplyScalar(0.92 + (y > 4 ? 0.1 : 0));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo} receiveShadow><meshStandardMaterial map={detail} vertexColors roughness={0.95} /></mesh>;
}

/** A jagged, snow-capped mountain range far behind, softened by the haze. */
export function Ridge() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(420, 70, 260, 40);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3), rock = new THREE.Color("#6f7a8c"), dark = new THREE.Color("#4e5868"), snow = new THREE.Color("#f2f0ee"), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const ridged = 1 - Math.abs(fbm(x * 0.018, z * 0.03 + 4, 6) * 2 - 1);
      const y = Math.pow(ridged, 2.2) * 58 * smooth(35, -5, z) + fbm(x * 0.06, z * 0.06) * 4;
      p.setY(i, y);
      c.copy(rock).lerp(dark, fbm(x * 0.1, z * 0.1, 3)).lerp(snow, smooth(30, 40, y));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  return <mesh geometry={geo} position={[0, -6, -135]}><meshStandardMaterial vertexColors roughness={1} /></mesh>;
}

// ---------------------------------------------------------------- trees

let canopyGeo: THREE.BufferGeometry | null = null;
function canopy() {
  if (canopyGeo) return canopyGeo;
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.getAttribute("position") as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + (fbm(v.x * 2.2 + 7, v.y * 2.2 + v.z * 1.7, 3) - 0.5) * 0.35;   // lumpy, leafy silhouette
    v.multiplyScalar(n); p.setXYZ(i, v.x, v.y * 0.92, v.z);
  }
  g.computeVertexNormals();
  canopyGeo = g;
  return g;
}

function LeafyTree({ x, z, s, tint }: { x: number; z: number; s: number; tint: string }) {
  const geo = useMemo(() => canopy(), []);
  const y = heightAt(x, z);
  return (
    <group position={[x, y, z]} scale={s}>
      <mesh position={[0, 0.9, 0]} castShadow><cylinderGeometry args={[0.12, 0.2, 1.8, 10]} /><meshStandardMaterial color="#5a3d26" roughness={1} /></mesh>
      {[[0, 2.3, 0, 1.05], [0.6, 2.0, 0.25, 0.75], [-0.55, 2.05, -0.2, 0.72], [0.1, 2.85, 0.1, 0.7]].map(([cx, cy, cz, r], i) => (
        <mesh key={i} geometry={geo} position={[cx, cy, cz]} scale={r} castShadow receiveShadow>
          <meshStandardMaterial color={tint} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function Conifer({ x, z, s }: { x: number; z: number; s: number }) {
  const y = heightAt(x, z);
  return (
    <group position={[x, y, z]} scale={s}>
      <mesh position={[0, 0.5, 0]} castShadow><cylinderGeometry args={[0.07, 0.11, 1, 8]} /><meshStandardMaterial color="#4b3220" roughness={1} /></mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 1.0 + i * 0.62, 0]} castShadow receiveShadow>
          <coneGeometry args={[1.05 - i * 0.22, 1.25, 14, 1]} /><meshStandardMaterial color={["#24452a", "#2b5231", "#325c37", "#3a663e"][i]} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

export function Woods() {
  const trees = useMemo(() => {
    const out: { x: number; z: number; s: number; pine: boolean; tint: string }[] = [];
    const tints = ["#3f6f2e", "#4b7d34", "#577f36", "#3a6a31", "#62873c"];
    for (let i = 0; i < 75; i++) {
      const x = -70 + hash(i, 101) * 140, z = -24 - hash(i, 102) * 40;
      if (hash(i, 106) < 0.35) continue;                                   // leave clearings so the sky shows through
      if (Math.abs(x - 7) < 3 && z > -32) continue;                       // keep the ride-away lane clear
      out.push({ x, z, s: 1.1 + hash(i, 103) * 1.2, pine: hash(i, 104) > 0.45, tint: tints[i % tints.length] });
    }
    out.push({ x: -11, z: -6.5, s: 1.6, pine: false, tint: "#4b7d34" }, { x: 12.5, z: -8, s: 1.8, pine: false, tint: "#577f36" },
      { x: -14, z: -10, s: 1.7, pine: true, tint: "" }, { x: 15, z: -12, s: 1.6, pine: true, tint: "" });
    return out;
  }, []);
  return <group>{trees.map((t, i) => t.pine ? <Conifer key={i} x={t.x} z={t.z} s={t.s} /> : <LeafyTree key={i} x={t.x} z={t.z} s={t.s} tint={t.tint} />)}</group>;
}

// ---------------------------------------------------------------- grass

/** A dense field of curved blades, coloured dark at the root and sunlit at the tip, swaying in rolling gusts (GPU). */
export function GrassField({ count = 10000 }: { count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const geo = useMemo(() => {
    // 4-segment curved blade with a vertex-colour gradient
    const segs = 4, w = 0.05, h = 0.3, pos: number[] = [], col: number[] = [], idx: number[] = [];
    const base = new THREE.Color("#25461c"), tip = new THREE.Color("#a8c46a"), c = new THREE.Color();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, ww = w * (1 - t * 0.85), bend = t * t * 0.12;
      pos.push(-ww, t * h, bend, ww, t * h, bend);
      c.copy(base).lerp(tip, t); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }, []);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3]);
          // slow, smooth gusts that roll across the field together (fast per-blade jitter made the grass glitter)
          float gust = sin(uTime * 1.1 - ip.x * 0.12 - ip.z * 0.07) * 0.5 + 0.5;
          float bend = (0.25 + gust * 0.75) * position.y * position.y * 1.6;
          transformed.x += bend;
          transformed.z += bend * 0.3;
        #endif`);
    };
    return m;
  }, [uniforms]);
  const setup = (m: THREE.InstancedMesh | null) => {
    if (!m || m.userData.done) return;
    mesh.current = m; m.userData.done = true;
    const o = new THREE.Object3D();
    let n = 0;
    for (let i = 0; n < count && i < count * 3; i++) {
      const x = (hash(i, 201) - 0.5) * 34, z = -10 + hash(i, 202) * 17;
      if (routeDistance(x, z) < 0.9) continue;                                  // the trail is worn bare
      if (((x - POND.x) / POND.rx) ** 2 + ((z - POND.z) / POND.rz) ** 2 < 1.1) continue;
      // blades far from the camera get wider (and sparser) so they never shrink below a pixel and shimmer
      const dist = Math.hypot(x, z - 7.2), wide = 1 + Math.max(0, dist - 5) * 0.22;
      if (dist > 9 && hash(i, 206) < Math.min(0.6, (dist - 9) * 0.06)) continue;
      o.position.set(x, heightAt(x, z), z);
      o.rotation.set(0, hash(i, 203) * Math.PI * 2, (hash(i, 204) - 0.5) * 0.3);
      o.scale.set(wide, 0.6 + hash(i, 205) * 0.9, wide);
      o.updateMatrix(); m.setMatrixAt(n++, o.matrix);
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  };
  useFrame(({ clock }) => { uniforms.uTime.value = clock.elapsedTime; });
  return <instancedMesh ref={setup} args={[geo, material, count]} />;   // no shadow on thin blades: it speckles and shimmers
}

// ---------------------------------------------------------------- water

/** A small pond that reflects the sky and trees. */
export function Pond() {
  return (
    <group position={[POND.x, heightAt(POND.x, POND.z) + 0.02, POND.z]}>
      <mesh rotation-x={-Math.PI / 2} scale={[POND.rx, POND.rz, 1]}>
        <circleGeometry args={[1, 64]} />
        <MeshReflectorMaterial resolution={512} mixBlur={1} mixStrength={2.2} blur={[300, 80]} mirror={0.75} color="#4f7f96" roughness={0.6} metalness={0.2} depthScale={0} />
      </mesh>
      {/* muddy, reedy bank */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 0]} scale={[POND.rx + 0.45, POND.rz + 0.35, 1]}>
        <circleGeometry args={[1, 64]} /><meshStandardMaterial color="#5d5236" roughness={1} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      {Array.from({ length: 26 }, (_, i) => {
        const a = (i / 26) * Math.PI * 2 + hash(i, 301) * 0.2, r = 1.02 + hash(i, 302) * 0.12;
        return (
          <mesh key={i} position={[Math.cos(a) * POND.rx * r, 0.25 + hash(i, 303) * 0.2, Math.sin(a) * POND.rz * r]} rotation-z={(hash(i, 304) - 0.5) * 0.3} castShadow>
            <cylinderGeometry args={[0.012, 0.02, 0.6 + hash(i, 305) * 0.5, 5]} /><meshStandardMaterial color="#5f7a3a" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}
