"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

let glowTex: THREE.Texture | null = null;

/** Soft radial gradient used for additive "bloom" halos (no post-processing pass needed). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** A glowing halo sprite; put it inside a mesh/group so it follows it. */
export function Glow({ color, size = 2, opacity = 0.8 }: { color: string; size?: number; opacity?: number }) {
  const map = useMemo(() => glowTexture(), []);
  return (
    <sprite scale={[size, size, 1]}>
      <spriteMaterial map={map} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
    </sprite>
  );
}

const N = 240;

/** Particle sparks. Returns [element, burst(x, y, z, color, count)]. */
export function useSparks(): [React.ReactElement, (x: number, y: number, z: number, color: string, count?: number) => void] {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3).fill(9999), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    return g;
  }, []);
  const state = useRef({ vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0 });
  const map = useMemo(() => glowTexture(), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  const burst = (x: number, y: number, z: number, color: string, count = 24) => {
    const s = state.current;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    tmp.set(color);
    for (let k = 0; k < count; k++) {
      const i = s.next; s.next = (s.next + 1) % N;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), sp = 3 + Math.random() * 5;
      pos.setXYZ(i, x, y, z);
      s.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      s.vel[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * sp;
      s.vel[i * 3 + 2] = Math.cos(ph) * sp;
      s.life[i] = 0.6 + Math.random() * 0.5;
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    pos.needsUpdate = col.needsUpdate = true;
  };

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.05);
    const s = state.current;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < N; i++) {
      if (s.life[i] <= 0) continue;
      any = true;
      s.life[i] -= dt;
      s.vel[i * 3 + 1] -= 6 * dt;
      pos.setXYZ(i, pos.getX(i) + s.vel[i * 3] * dt, pos.getY(i) + s.vel[i * 3 + 1] * dt, pos.getZ(i) + s.vel[i * 3 + 2] * dt);
      const f = Math.max(0, s.life[i]) / 1.1;
      col.setXYZ(i, col.getX(i) * (0.97 + 0.03 * f), col.getY(i) * (0.97 + 0.03 * f), col.getZ(i) * (0.97 + 0.03 * f));
      if (s.life[i] <= 0) pos.setXYZ(i, 9999, 9999, 9999);
    }
    if (any) pos.needsUpdate = col.needsUpdate = true;
  });

  const el = (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial size={0.35} map={map} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  );
  return [el, burst];
}
