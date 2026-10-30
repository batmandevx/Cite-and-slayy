"use client";

/**
 * 3D citation constellation for a CiteGuard audit (real data only).
 * The paper is the core; every parsed reference is a node on a sphere around it.
 * Status is encoded by colour AND shape, so it never relies on colour alone:
 *   verified = sphere (green) · metadata mismatch = octahedron/diamond (amber) · not found = cube (red)
 *   could not verify = small wireframe sphere (grey) · retracted = large red octahedron with a pulsing alarm ring
 * Node size grows with how many in-text citations point at that reference.
 */
import { Line, OrbitControls, Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AuditReport, ReferenceCheck } from "@/lib/types";

const COLOR = { verified: "#0ca30c", metadata_mismatch: "#fab219", not_found: "#d03b3b", could_not_verify: "#898781", retracted: "#ff3b3b" };
const LABEL = { verified: "Verified", metadata_mismatch: "Metadata mismatch", not_found: "Not found", could_not_verify: "Could not verify" };
const tmp = new THREE.Vector3();

function kind(r: ReferenceCheck) {
  return r.retraction === "retracted" ? "retracted" : r.status;
}

function Node({ r, pos, size, onPick, onHover, reduced }: {
  r: ReferenceCheck; pos: [number, number, number]; size: number; onPick: (i: number) => void;
  onHover: (r: ReferenceCheck | null) => void; reduced: boolean;
}) {
  const g = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const k = kind(r);
  const color = COLOR[k];
  useFrame((s) => {
    if (!g.current) return;
    const target = hover ? 1.45 : 1;
    g.current.scale.lerp(tmp.set(target, target, target), 0.15);
    if (!reduced) g.current.rotation.y += 0.01;
    if (ring.current && !reduced) {
      const t = (s.clock.elapsedTime * 0.9) % 1;
      ring.current.scale.setScalar(1 + t * 1.8);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
    }
  });
  const geo =
    k === "verified" ? <sphereGeometry args={[size, 24, 24]} />
    : k === "metadata_mismatch" ? <octahedronGeometry args={[size * 1.25]} />
    : k === "not_found" ? <boxGeometry args={[size * 1.5, size * 1.5, size * 1.5]} />
    : k === "retracted" ? <octahedronGeometry args={[size * 1.7]} />
    : <sphereGeometry args={[size * 0.8, 10, 8]} />;
  return (
    <group position={pos}>
      <group ref={g}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); onHover(r); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); onHover(null); document.body.style.cursor = ""; }}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(r.ref_index); }}>
        <mesh>
          {geo}
          {k === "could_not_verify"
            ? <meshBasicMaterial color={color} wireframe />
            : <meshStandardMaterial color={color} emissive={color} emissiveIntensity={k === "retracted" ? 1.6 : 0.7} roughness={0.35} toneMapped={false} />}
        </mesh>
      </group>
      {k === "retracted" && (
        <mesh ref={ring} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
          <torusGeometry args={[size * 2.4, 0.03, 8, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Core({ score, reduced }: { score: number; reduced: boolean }) {
  const m = useRef<THREE.Mesh>(null);
  const color = score >= 80 ? "#0ca30c" : score >= 50 ? "#fab219" : "#d03b3b";
  useFrame((s) => {
    if (!m.current || reduced) return;
    m.current.rotation.y += 0.004;
    m.current.scale.setScalar(1 + Math.sin(s.clock.elapsedTime * 1.4) * 0.04);
  });
  return (
    <mesh ref={m}>
      <icosahedronGeometry args={[0.7, 1]} />
      <meshStandardMaterial color="#cde2fb" emissive={color} emissiveIntensity={0.9} wireframe toneMapped={false} />
    </mesh>
  );
}

export default function CitationConstellation({ report, onPick, reduced = false }: { report: AuditReport; onPick: (refIndex: number) => void; reduced?: boolean }) {
  const [hovered, setHovered] = useState<ReferenceCheck | null>(null);
  const flagged = report.references.filter((r) => kind(r) !== "verified");
  const cites = useMemo(() => {
    const m = new Map<number, number>();
    report.claims.forEach((c) => m.set(c.ref_index, (m.get(c.ref_index) ?? 0) + 1));
    return m;
  }, [report]);
  const nodes = useMemo(() => {
    const n = report.references.length;
    const golden = Math.PI * (3 - Math.sqrt(5));
    return report.references.map((r, i) => {
      const y = 1 - (i / Math.max(1, n - 1)) * 2;           // fibonacci sphere: even spacing
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i;
      const R = 4.2 + (kind(r) === "verified" ? 0 : 0.6);    // problems float slightly outward
      return { r, pos: [Math.cos(th) * rad * R, y * R * 0.75, Math.sin(th) * rad * R] as [number, number, number],
               size: 0.13 + Math.min(0.17, 0.05 * (cites.get(r.ref_index) ?? 0)) };
    });
  }, [report, cites]);
  return (
    <>
    <Canvas dpr={[1, 2]} camera={{ position: [0, 2.5, 10.5], fov: 45 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 0, 0]} intensity={25} color="#86b6ef" />
      <pointLight position={[6, 6, 6]} intensity={30} />
      <Stars radius={60} depth={30} count={1500} factor={2.5} fade speed={reduced ? 0 : 0.5} />
      <Sparkles count={50} scale={[12, 7, 12]} size={2} speed={reduced ? 0 : 0.2} opacity={0.35} color="#9ec5f4" />
      <Core score={report.score} reduced={reduced} />
      {nodes.map(({ r, pos }) => (
        <Line key={`l${r.ref_index}`} points={[[0, 0, 0], pos]} color={COLOR[kind(r)]} lineWidth={1}
          transparent opacity={kind(r) === "verified" ? 0.18 : 0.55} dashed={kind(r) !== "verified"} dashSize={0.2} gapSize={0.12} />
      ))}
      {nodes.map(({ r, pos, size }) => <Node key={r.ref_index} r={r} pos={pos} size={size} onPick={onPick} onHover={setHovered} reduced={reduced} />)}
      <OrbitControls enablePan={false} minDistance={6} maxDistance={18} autoRotate={!reduced && !hovered} autoRotateSpeed={0.5} enableDamping />
    </Canvas>

    {/* Plain-HTML overlays: always readable, keyboard-clickable, and not colour-only */}
    {flagged.length > 0 && (
      <div className="absolute left-3 top-3 z-10 flex max-w-[46%] flex-col gap-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#c3c2b7]">Needs attention</div>
        {flagged.slice(0, 6).map((r) => {
          const k = kind(r);
          return (
            <button key={r.ref_index} onClick={() => onPick(r.ref_index)}
              onMouseEnter={() => setHovered(r)} onMouseLeave={() => setHovered(null)}
              className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/45 px-2.5 py-1.5 text-left text-xs text-[#f0efec] backdrop-blur transition hover:border-white/35 hover:bg-black/60">
              <span className={`inline-block size-2.5 shrink-0 ${k === "verified" ? "rounded-full" : k === "not_found" ? "" : k === "could_not_verify" ? "rounded-full border border-[#c3c2b7]" : "rotate-45"}`}
                style={k === "could_not_verify" ? {} : { background: COLOR[k] }} />
              <b className="shrink-0">{r.label}</b>
              <span className={k === "retracted" ? "font-semibold text-[#ff8a8a]" : "text-[#c3c2b7]"}>{k === "retracted" ? "RETRACTED" : LABEL[r.status]}</span>
              <span className="truncate text-[#898781]">{(r.matched?.title ?? r.parsed.title ?? r.parsed.raw).slice(0, 48)}</span>
            </button>
          );
        })}
        {flagged.length > 6 && <div className="text-[11px] text-[#898781]">+{flagged.length - 6} more in References</div>}
      </div>
    )}
    <div className="absolute bottom-3 right-3 z-10 max-w-[48%] rounded-xl border border-white/15 bg-black/50 px-3 py-2 text-xs text-[#f0efec] backdrop-blur transition-opacity"
      style={{ opacity: hovered ? 1 : 0.75 }}>
      {hovered ? (
        <>
          <div className="font-semibold">{hovered.label} · {kind(hovered) === "retracted" ? "RETRACTED" : LABEL[hovered.status]}
            {(cites.get(hovered.ref_index) ?? 0) > 0 && <span className="font-normal text-[#c3c2b7]"> · cited {cites.get(hovered.ref_index)}×</span>}</div>
          <div className="mt-0.5 line-clamp-2 text-[#c3c2b7]">{hovered.matched?.title ?? hovered.parsed.title ?? hovered.parsed.raw}</div>
          <div className="mt-1 text-[10px] text-[#898781]">Click to open its evidence</div>
        </>
      ) : (
        <span>{report.references.length - flagged.length} of {report.references.length} references verified · hover a node</span>
      )}
    </div>
    </>
  );
}
