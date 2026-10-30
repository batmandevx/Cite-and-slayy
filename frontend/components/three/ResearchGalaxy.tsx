"use client";

/**
 * 3D "research galaxy" of a real Gap Radar scan.
 * - Each orb is a cluster: size ∝ √papers, colour = classification (validated palette, dark-stage steps),
 *   Unclassified is a wireframe (never colour alone).
 * - Each orbiting dot is one paper of that cluster (capped at 160 per cluster for performance).
 * - "explore" mode places orbs on meaningful axes: x = growth, y = citations/year, z = recency.
 * - "hero" mode arranges the same clusters on an orbit around the field core.
 * With no scan yet, a purely decorative nebula is shown (no labels, no numbers).
 */
import { Html, Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Cluster, GapClass, GapRadarResult } from "@/lib/types";

export const GALAXY_COLORS: Record<GapClass, string> = {
  underexplored: "#3987e5", rising: "#d95926", saturated: "#199e70", unclassified: "#b9b7ae",
};
const LABEL: Record<GapClass, string> = {
  underexplored: "Underexplored", rising: "Rising", saturated: "Saturated", unclassified: "Unclassified",
};
const MAX_DOTS = 160;

function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let glowTexture: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (!glowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.18, "rgba(255,255,255,0.55)");
    grd.addColorStop(0.45, "rgba(255,255,255,0.12)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    glowTexture = new THREE.CanvasTexture(c);
  }
  return glowTexture;
}

const tmp = new THREE.Vector3();

function ClusterOrb({
  c, position, radius, selected, showLabel, interactive, reduced, onSelect,
}: {
  c: Cluster; position: [number, number, number]; radius: number; selected: boolean; showLabel: boolean;
  interactive: boolean; reduced: boolean; onSelect?: (id: number) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const dots = useRef<THREE.Points>(null);
  const [hover, setHover] = useState(false);
  const color = GALAXY_COLORS[c.classification];
  const hollow = c.classification === "unclassified";
  const n = Math.min(c.size, MAX_DOTS);

  const dotPositions = useMemo(() => {
    const r = seeded(c.cluster_id + 7);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1;
      const th = r() * Math.PI * 2;
      const rad = radius * (1.7 + r() * 1.6);
      const s = Math.sqrt(1 - u * u);
      arr[i * 3] = rad * s * Math.cos(th);
      arr[i * 3 + 1] = rad * u * 0.45;
      arr[i * 3 + 2] = rad * s * Math.sin(th);
    }
    return arr;
  }, [c.cluster_id, n, radius]);

  useFrame((state, dt) => {
    if (!group.current) return;
    const k = hover || selected ? 1.22 : 1;
    group.current.scale.lerp(tmp.set(k, k, k), 0.12);
    if (reduced) return;
    if (dots.current) dots.current.rotation.y += dt * (0.18 + 0.12 / radius);
    group.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.7 + c.cluster_id) * 0.07;
  });

  const handlers = interactive
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; },
        onPointerOut: () => { setHover(false); document.body.style.cursor = ""; },
        onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect?.(c.cluster_id); },
      }
    : {};

  return (
    <group ref={group} position={position}>
      <mesh {...handlers}>
        <sphereGeometry args={hollow ? [radius, 14, 10] : [radius, 48, 48]} />
        {hollow ? (
          <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
        ) : (
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} roughness={0.3} metalness={0.15} toneMapped={false} />
        )}
      </mesh>
      <sprite scale={[radius * 5.2, radius * 5.2, 1]} raycast={() => null}>
        <spriteMaterial map={glow()} color={color} transparent opacity={hollow ? 0.18 : 0.7}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <points ref={dots} raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dotPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.055} color={color} transparent opacity={0.85} sizeAttenuation depthWrite={false}
          blending={THREE.AdditiveBlending} />
      </points>
      {selected && (
        <mesh rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[radius * 1.45, 0.014, 8, 128]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
      {(showLabel || hover || selected) && (
        <Html center position={[0, radius + 0.42, 0]} distanceFactor={10} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`galaxy-label ${hover || selected ? "is-active" : ""}`}>
            <span className="galaxy-dot" style={hollow ? { border: `1.5px dashed ${color}` } : { background: color }} />
            <span className="galaxy-name">{hover || selected || c.label.length <= 24 ? c.label : c.label.slice(0, 23) + "…"}</span>
            {(hover || selected) && (
              <span className="galaxy-meta">
                {LABEL[c.classification]} · {c.size} papers · growth {(c.growth * 100).toFixed(0)}% · {c.cites_per_year.toFixed(1)} cites/yr
              </span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

function FieldCore({ reduced }: { reduced: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current || reduced) return;
    const k = 1 + Math.sin(s.clock.elapsedTime * 1.6) * 0.06;
    ref.current.scale.set(k, k, k);
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.32, 2]} />
        <meshStandardMaterial color="#cde2fb" emissive="#86b6ef" emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      <sprite scale={[3.2, 3.2, 1]} raycast={() => null}>
        <spriteMaterial map={glow()} color="#86b6ef" transparent opacity={0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
    </group>
  );
}

function Nebula({ reduced }: { reduced: boolean }) {
  // Decorative only: shown before any scan exists.
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const r = seeded(42);
    const n = 1800;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const arm = i % 3;
      const t = r() * 6;
      const ang = t + (arm * Math.PI * 2) / 3;
      const spread = 0.35 + t * 0.12;
      arr[i * 3] = Math.cos(ang) * t + (r() - 0.5) * spread;
      arr[i * 3 + 1] = (r() - 0.5) * 0.5;
      arr[i * 3 + 2] = Math.sin(ang) * t + (r() - 0.5) * spread;
    }
    return arr;
  }, []);
  useFrame((_, dt) => { if (ref.current && !reduced) ref.current.rotation.y += dt * 0.06; });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.05} color="#86b6ef" transparent opacity={0.75} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function norm(values: number[]) {
  const lo = Math.min(...values), hi = Math.max(...values);
  return (v: number) => (hi - lo < 1e-9 ? 0 : ((v - lo) / (hi - lo)) * 2 - 1);
}

function Scene({
  run, mode, selected, onSelect, reduced,
}: { run: GapRadarResult | null; mode: "hero" | "explore"; selected: number | null; onSelect?: (id: number) => void; reduced: boolean }) {
  const layout = useMemo(() => {
    if (!run) return [];
    const maxSize = Math.max(...run.clusters.map((c) => c.size));
    const radius = (c: Cluster) => 0.22 + 0.42 * Math.sqrt(c.size / maxSize);
    if (mode === "explore") {
      const gx = norm(run.clusters.map((c) => c.growth));
      const cy = norm(run.clusters.map((c) => c.cites_per_year));
      const rz = norm(run.clusters.map((c) => c.recency_share));
      return run.clusters.map((c) => ({ c, r: radius(c), p: [gx(c.growth) * 6.2, cy(c.cites_per_year) * 3.4, rz(c.recency_share) * 3.6] as [number, number, number] }));
    }
    const n = run.clusters.length;
    return run.clusters.map((c, i) => {
      const a = (i / n) * Math.PI * 2;
      const R = 4.4 + (i % 2) * 0.9;
      return { c, r: radius(c), p: [Math.cos(a) * R, Math.sin(a * 2) * 0.6 + c.growth * 0.3, Math.sin(a) * R] as [number, number, number] };
    });
  }, [run, mode]);

  return (
    <>
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 0, 0]} intensity={30} color="#86b6ef" />
      <pointLight position={[8, 8, 6]} intensity={40} color="#ffffff" />
      <Stars radius={70} depth={45} count={2600} factor={3.2} saturation={0} fade speed={reduced ? 0 : 0.6} />
      <Sparkles count={90} scale={[16, 7, 16]} size={2.2} speed={reduced ? 0 : 0.25} opacity={0.45} color="#9ec5f4" />
      {!run && <Nebula reduced={reduced} />}
      {run && mode === "hero" && <FieldCore reduced={reduced} />}
      {run && mode === "hero" && layout.map(({ c, p }) => (
        <Line key={`l${c.cluster_id}`} points={[[0, 0, 0], p]} color={GALAXY_COLORS[c.classification]} lineWidth={1} transparent opacity={0.22} />
      ))}
      {run && mode === "explore" && <Axes />}
      {layout.map(({ c, p, r }) => (
        <ClusterOrb key={c.cluster_id} c={c} position={p} radius={r} selected={selected === c.cluster_id}
          showLabel={mode === "explore"} interactive={!!onSelect} reduced={reduced} onSelect={onSelect} />
      ))}
    </>
  );
}

function Axes() {
  const o: [number, number, number] = [-7, -4, -4.2];
  const axes: { to: [number, number, number]; label: string }[] = [
    { to: [7.2, -4, -4.2], label: "Growth →" },
    { to: [-7, 4.2, -4.2], label: "Citations / yr ↑" },
    { to: [-7, -4, 4.4], label: "Recency ↗" },
  ];
  return (
    <group>
      {axes.map((a) => (
        <group key={a.label}>
          <Line points={[o, a.to]} color="#c3c2b7" lineWidth={1} transparent opacity={0.35} dashed dashSize={0.25} gapSize={0.15} />
          <Html position={[a.to[0] + (a.to[0] > 0 ? 0.6 : 0), a.to[1] + (a.to[1] > 0 ? 0.5 : -0.35), a.to[2] + (a.to[2] > 0 ? 0.6 : 0)]} center distanceFactor={12} style={{ pointerEvents: "none" }}>
            <div className="galaxy-axis">{a.label}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

export default function ResearchGalaxy({
  run, mode, selected = null, onSelect, reduced = false, className,
}: {
  run: GapRadarResult | null; mode: "hero" | "explore"; selected?: number | null; onSelect?: (id: number) => void;
  reduced?: boolean; className?: string;
}) {
  const camera = mode === "hero" ? { position: [0, 3.6, 13.5] as [number, number, number], fov: 45 } : { position: [2.5, 2.2, 16] as [number, number, number], fov: 42 };
  return (
    <div className={className}>
      <Canvas dpr={[1, 2]} camera={camera} gl={{ antialias: true, alpha: true }} onPointerMissed={() => (document.body.style.cursor = "")}>
        <Scene run={run} mode={mode} selected={selected} onSelect={onSelect} reduced={reduced} />
        <OrbitControls enablePan={false} enableZoom={mode === "explore"} minDistance={6} maxDistance={28}
          autoRotate={!reduced && mode === "hero"} autoRotateSpeed={0.55} enableDamping makeDefault />
      </Canvas>
    </div>
  );
}
