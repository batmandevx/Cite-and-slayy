"use client";

import { useFrame } from "@react-three/fiber";
import { forwardRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { Glow, glowTexture } from "./fx";

/** Deterministic pseudo-random in [0,1) for initial layouts (keeps render pure). */
const hash = (i: number, k: number) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

/** Swept-wing jet built from primitives: fuselage, nose, canopy, delta wings, tail fins, twin engines, nav lights. */
export const Jet = forwardRef<THREE.Group, { color?: string; accent?: string }>(function Jet({ color = "#f4f1ea", accent = "#ff4fa3" }, ref) {
  const wing = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.35); s.lineTo(1.25, -0.35); s.lineTo(1.25, -0.55); s.lineTo(0, -0.25); s.lineTo(0, 0.35);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const fin = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(0.42, 0); s.lineTo(0.18, 0.5); s.lineTo(0.05, 0.5); s.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    return g;
  }, []);
  const lightL = useRef<THREE.MeshBasicMaterial>(null), lightR = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const on = Math.sin(clock.elapsedTime * 6) > 0.6;
    if (lightL.current) lightL.current.opacity = on ? 1 : 0.25;
    if (lightR.current) lightR.current.opacity = on ? 0.25 : 1;
  });
  return (
    <group ref={ref}>
      {/* fuselage (nose points to -z) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}><capsuleGeometry args={[0.17, 1.35, 8, 16]} /><meshStandardMaterial color={color} metalness={0.55} roughness={0.25} /></mesh>
      <mesh position={[0, 0, -0.98]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.12, 0.35, 16]} /><meshStandardMaterial color={accent} metalness={0.4} roughness={0.3} /></mesh>
      {/* canopy */}
      <mesh position={[0, 0.14, -0.38]} scale={[0.13, 0.11, 0.36]}><sphereGeometry args={[1, 20, 16]} />
        <meshPhysicalMaterial color="#5ad7ff" metalness={0.1} roughness={0.05} transmission={0.4} transparent opacity={0.85} emissive="#0a5a7a" emissiveIntensity={0.4} /></mesh>
      {/* racing stripe */}
      <mesh position={[0, 0.172, 0.15]}><boxGeometry args={[0.07, 0.01, 0.9]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.4} /></mesh>
      {/* wings */}
      <mesh geometry={wing} position={[0.12, -0.02, 0.2]}><meshStandardMaterial color={color} metalness={0.5} roughness={0.3} /></mesh>
      <mesh geometry={wing} position={[-0.12, -0.02, 0.2]} scale={[-1, 1, 1]}><meshStandardMaterial color={color} metalness={0.5} roughness={0.3} side={THREE.DoubleSide} /></mesh>
      {/* wing stripes */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[side * 0.95, 0.02, 0.62]} rotation={[0, side * 0.5, 0]}><boxGeometry args={[0.35, 0.012, 0.06]} /><meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} /></mesh>
      ))}
      {/* tail fins + tailplane */}
      <mesh geometry={fin} position={[0.11, 0.1, 0.62]} rotation={[0, 0, -0.35]}><meshStandardMaterial color={accent} metalness={0.4} roughness={0.35} /></mesh>
      <mesh geometry={fin} position={[-0.11, 0.1, 0.62]} rotation={[0, 0, 0.35]}><meshStandardMaterial color={accent} metalness={0.4} roughness={0.35} /></mesh>
      <mesh position={[0, 0, 0.78]}><boxGeometry args={[0.95, 0.03, 0.22]} /><meshStandardMaterial color={color} metalness={0.5} roughness={0.3} /></mesh>
      {/* engines */}
      {[0.1, -0.1].map((x) => (
        <group key={x} position={[x, -0.03, 0.88]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.075, 0.09, 0.2, 16]} /><meshStandardMaterial color="#333" metalness={0.8} roughness={0.3} /></mesh>
          <mesh position={[0, 0, 0.12]}><circleGeometry args={[0.07, 16]} /><meshBasicMaterial color="#ffb347" /></mesh>
          <group position={[0, 0, 0.2]}><Glow color="#ff8a3d" size={0.9} opacity={0.9} /></group>
        </group>
      ))}
      {/* nav lights */}
      <mesh position={[1.36, 0.02, 0.62]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial ref={lightR} color="#3dff8a" transparent /></mesh>
      <mesh position={[-1.36, 0.02, 0.62]}><sphereGeometry args={[0.035, 8, 8]} /><meshBasicMaterial ref={lightL} color="#ff3b5c" transparent /></mesh>
    </group>
  );
});

const TRAIL = 220;

/** Contrail particles emitted from the given local points of a moving object, streaming backwards at `speed`. */
export function useContrail(points: [number, number, number][], color = "#cfe9ff"): [React.ReactElement, (obj: THREE.Object3D | null, speed: number, dt: number) => void] {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3).fill(9999), 3));
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(TRAIL), 1));
    return g;
  }, []);
  const st = useRef({ life: new Float32Array(TRAIL), next: 0, acc: 0 });
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 0.28, map: glowTexture(), color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false }), [color]);
  const step = (obj: THREE.Object3D | null, speed: number, dt: number) => {
    const s = st.current;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < TRAIL; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt;
      pos.setZ(i, pos.getZ(i) + speed * dt);
      if (s.life[i] <= 0) pos.setXYZ(i, 9999, 9999, 9999);
    }
    if (obj) {
      s.acc += dt;
      while (s.acc > 0.012) {
        s.acc -= 0.012;
        for (const p of points) {
          tmp.set(...p);
          obj.localToWorld(tmp);
          const i = s.next; s.next = (s.next + 1) % TRAIL;
          pos.setXYZ(i, tmp.x + (Math.random() - 0.5) * 0.04, tmp.y + (Math.random() - 0.5) * 0.04, tmp.z);
          s.life[i] = 0.45;
        }
      }
    }
    pos.needsUpdate = true;
  };
  return [<points key="contrail" geometry={geo} material={mat} frustumCulled={false} />, step];
}

/** Warp-speed streaks flying past the camera. */
export function WarpStreaks({ speedRef, count = 90, color = "#9fd8ff" }: { speedRef: React.RefObject<number>; count?: number; color?: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (hash(i, 1) - 0.5) * 30, y: (hash(i, 2) - 0.5) * 18, z: -hash(i, 3) * 120,
  })), [count]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const sp = (speedRef.current ?? 20) * 2.2;
    data.forEach((d, i) => {
      d.z += sp * dt;
      if (d.z > 8) { d.z = -120; d.x = (Math.random() - 0.5) * 30; d.y = (Math.random() - 0.5) * 18; }
      if (Math.abs(d.x) < 3 && Math.abs(d.y) < 2) d.x += d.x < 0 ? -3 : 3;
      m.makeScale(1, 1, 1 + sp * 0.06);
      m.setPosition(d.x, d.y, d.z);
      mesh.current?.setMatrixAt(i, m);
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <boxGeometry args={[0.03, 0.03, 0.9]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}

/** Spinning low-poly crystals drifting past for depth. */
export function Crystals({ speedRef, count = 26 }: { speedRef: React.RefObject<number>; count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (hash(i, 1) < 0.5 ? -1 : 1) * (7 + hash(i, 2) * 12), y: (hash(i, 3) - 0.5) * 14, z: -hash(i, 4) * 110,
    s: 0.4 + hash(i, 5) * 1.4, r: hash(i, 6) * 6, v: (hash(i, 7) - 0.5) * 2,
  })), [count]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(() => {
    const c = new Float32Array(count * 3);
    const pal = ["#ff4fa3", "#8f7bff", "#4fe3ff", "#ffd23f"].map((h) => new THREE.Color(h));
    for (let i = 0; i < count; i++) pal[i % 4].toArray(c, i * 3);
    return c;
  }, [count]);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const sp = speedRef.current ?? 20;
    data.forEach((d, i) => {
      d.z += sp * 0.6 * dt; d.r += d.v * dt;
      if (d.z > 10) { d.z = -110; d.y = (Math.random() - 0.5) * 14; }
      o.position.set(d.x, d.y, d.z); o.rotation.set(d.r, d.r * 0.7, 0); o.scale.setScalar(d.s); o.updateMatrix();
      mesh.current?.setMatrixAt(i, o.matrix);
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <octahedronGeometry args={[1, 0]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </octahedronGeometry>
      <meshStandardMaterial vertexColors flatShading emissive="#2a1650" emissiveIntensity={0.6} metalness={0.3} roughness={0.4} />
    </instancedMesh>
  );
}

/** Striped synthwave sun on the horizon. */
export function SynthSun({ position = [0, 6, -95] as [number, number, number], size = 22 }) {
  const tex = useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#ffd23f"); grd.addColorStop(0.55, "#ff4fa3"); grd.addColorStop(1, "#8f2bff");
    g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out";
    for (let k = 0; k < 7; k++) { const y = 140 + k * 17; g.fillRect(0, y, 256, 3 + k * 1.6); }
    return new THREE.CanvasTexture(c);
  }, []);
  return (
    <group position={position}>
      <mesh><planeGeometry args={[size, size]} /><meshBasicMaterial map={tex} transparent fog={false} depthWrite={false} /></mesh>
      <sprite scale={[size * 1.9, size * 1.9, 1]} position={[0, 0, -0.5]}>
        <spriteMaterial map={glowTexture()} color="#ff4fa3" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </sprite>
    </group>
  );
}

/** Neon city blocks scrolling along both sides of a track. */
export function NeonCity({ speedRef, count = 36 }: { speedRef: React.RefObject<number>; count?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (i % 2 ? 1 : -1) * (6 + hash(i, 1) * 6), z: -(i / count) * 120, h: 2 + hash(i, 2) * 9, w: 1.2 + hash(i, 3) * 2,
  })), [count]);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const sp = speedRef.current ?? 14;
    data.forEach((d, i) => {
      d.z += sp * dt;
      if (d.z > 10) { d.z -= 130; d.h = 2 + Math.random() * 9; }
      o.position.set(d.x, d.h / 2 - 0.05, d.z); o.scale.set(d.w, d.h, d.w); o.updateMatrix();
      mesh.current?.setMatrixAt(i, o.matrix);
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#1b1238" emissive="#5b21b6" emissiveIntensity={0.35} metalness={0.6} roughness={0.35} />
    </instancedMesh>
  );
}
