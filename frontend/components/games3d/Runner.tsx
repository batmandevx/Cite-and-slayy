"use client";
 

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

const SUIT = "#1b1630", ACCENT = "#c6f24e", SKIN = "#c98f6b";

/** A limb that hangs from its pivot: upper segment with a joint and a lower segment that bends. */
function Limb({ upper, lower, r, color, foot, topRef, jointRef }: {
  upper: number; lower: number; r: number; color: string; foot?: boolean; topRef: React.RefObject<Group | null>; jointRef: React.RefObject<Group | null>;
}) {
  return (
    <group ref={topRef}>
      <mesh position={[0, -upper / 2, 0]} castShadow><capsuleGeometry args={[r, upper - r * 2, 6, 12]} /><meshStandardMaterial color={color} roughness={0.55} /></mesh>
      <mesh position={[0, -upper / 2, r * 0.95]}><boxGeometry args={[r * 0.5, upper * 0.7, 0.01]} /><meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.9} /></mesh>
      <group ref={jointRef} position={[0, -upper, 0]}>
        <mesh position={[0, -lower / 2, 0]} castShadow><capsuleGeometry args={[r * 0.88, lower - r * 1.8, 6, 12]} /><meshStandardMaterial color={foot ? SUIT : SKIN} roughness={0.6} /></mesh>
        {foot && (
          <mesh position={[0, -lower - 0.02, 0.07]} castShadow><boxGeometry args={[0.16, 0.09, 0.3]} /><meshStandardMaterial color="#ffffff" roughness={0.35} /></mesh>
        )}
        {foot && <mesh position={[0, -lower - 0.065, 0.07]}><boxGeometry args={[0.17, 0.02, 0.31]} /><meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1.2} /></mesh>}
      </group>
    </group>
  );
}

const useLimb = () => ({ top: useRef<Group>(null), joint: useRef<Group>(null) });

/** Third-person runner (seen from behind). `pose()` gives distance travelled, height above ground and whether airborne. */
export function Runner({ pose }: { pose: () => { x: number; lift: number; dist: number; air: boolean; dead: boolean; lean: number } }) {
  const root = useRef<Group>(null), body = useRef<Group>(null), head = useRef<Group>(null);
  const armL = useLimb(), armR = useLimb(), legL = useLimb(), legR = useLimb();
  useFrame(() => {
    const p = pose();
    const ph = p.dist * 1.15;                 // stride phase follows ground speed
    const s = Math.sin(ph), c = Math.cos(ph);
    if (root.current) {
      root.current.position.set(p.x, p.lift + (p.air ? 0 : Math.abs(Math.sin(ph)) * 0.07), 0);
      root.current.rotation.z = -p.lean * 0.25;
      root.current.rotation.x = p.dead ? -1.2 : 0;
    }
    if (body.current) { body.current.rotation.x = 0.22; body.current.rotation.y = s * 0.12; }
    if (head.current) head.current.rotation.x = -0.15;
    if (p.air) {        // tuck
      legL.top.current?.rotation.set(-1.1, 0, 0); legL.joint.current?.rotation.set(1.6, 0, 0);
      legR.top.current?.rotation.set(-0.7, 0, 0); legR.joint.current?.rotation.set(1.3, 0, 0);
      armL.top.current?.rotation.set(-2.2, 0, 0.3); armR.top.current?.rotation.set(-2.2, 0, -0.3);
      armL.joint.current?.rotation.set(-0.4, 0, 0); armR.joint.current?.rotation.set(-0.4, 0, 0);
      return;
    }
    legL.top.current?.rotation.set(-s * 0.95, 0, 0);
    legR.top.current?.rotation.set(s * 0.95, 0, 0);
    legL.joint.current?.rotation.set(Math.max(0, c) * 1.5 + 0.15, 0, 0);
    legR.joint.current?.rotation.set(Math.max(0, -c) * 1.5 + 0.15, 0, 0);
    armL.top.current?.rotation.set(s * 0.9, 0, 0.12);
    armR.top.current?.rotation.set(-s * 0.9, 0, -0.12);
    armL.joint.current?.rotation.set(-1.1, 0, 0);
    armR.joint.current?.rotation.set(-1.1, 0, 0);
  });
  return (
    <group ref={root} rotation-y={Math.PI}>
      <group ref={body} position={[0, 0.95, 0]}>
        {/* torso + hoodie */}
        <mesh position={[0, 0.32, 0]} castShadow><capsuleGeometry args={[0.2, 0.36, 8, 16]} /><meshStandardMaterial color={SUIT} roughness={0.5} /></mesh>
        <mesh position={[0, 0.34, 0.205]}><boxGeometry args={[0.06, 0.36, 0.01]} /><meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={1} /></mesh>
        <mesh position={[0, 0.42, -0.17]} castShadow><boxGeometry args={[0.28, 0.32, 0.12]} /><meshStandardMaterial color="#ff4fa3" roughness={0.45} /></mesh>
        <mesh position={[0, 0.0, 0]}><capsuleGeometry args={[0.19, 0.06, 6, 12]} /><meshStandardMaterial color="#2b2547" /></mesh>
        <group ref={head} position={[0, 0.78, 0.02]}>
          <mesh castShadow><sphereGeometry args={[0.15, 24, 24]} /><meshStandardMaterial color={SKIN} roughness={0.6} /></mesh>
          <mesh position={[0, 0.05, -0.01]}><sphereGeometry args={[0.158, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.9]} /><meshStandardMaterial color="#121212" roughness={0.8} /></mesh>
          <mesh position={[0, 0.0, 0.11]}><boxGeometry args={[0.24, 0.06, 0.08]} /><meshStandardMaterial color="#4fe3ff" emissive="#4fe3ff" emissiveIntensity={1.4} metalness={0.6} roughness={0.1} /></mesh>
        </group>
        <group position={[-0.27, 0.58, 0]}><Limb upper={0.32} lower={0.3} r={0.065} color={SUIT} topRef={armL.top} jointRef={armL.joint} /></group>
        <group position={[0.27, 0.58, 0]}><Limb upper={0.32} lower={0.3} r={0.065} color={SUIT} topRef={armR.top} jointRef={armR.joint} /></group>
        <group position={[-0.11, -0.02, 0]}><Limb upper={0.44} lower={0.42} r={0.085} color={SUIT} foot topRef={legL.top} jointRef={legL.joint} /></group>
        <group position={[0.11, -0.02, 0]}><Limb upper={0.44} lower={0.42} r={0.085} color={SUIT} foot topRef={legR.top} jointRef={legR.joint} /></group>
      </group>
    </group>
  );
}
