"use client";
/* eslint-disable react-hooks/immutability -- animation state lives in refs and is mutated per frame inside useFrame */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MeshReflectorMaterial, useAnimations, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { AnimatePresence, motion } from "motion/react";
import { Volume2, VolumeX } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { type KnightCue, type KnightSound, startKnightSound } from "./knightSound";

// A hidden treat on a team card: a rainy night alley, a cloud of bats, a caped figure stepping out of the
// shadows, and a bat-shaped dart thrown into a poster with the founder's name on it.
// Figure: "Man" by Quaternius, CC0 1.0 (see public/models/easter/CREDITS.txt), dressed in a cowl and cape here.

const MAN_URL = "/models/easter/knight.glb";
const DURATION = 10.4;                       // seconds until the fade-out
const T_BATS = 0.3, T_THUNDER = 1.7, T_WALK = 0.9, T_STOP = 4.1, T_THROW = 5.05, T_RELEASE = 5.42, T_HIT = 5.98, T_VANISH = 7.5;
const FIGURE_HEIGHT = 1.88;
const WALL_X = 4;                           // right-hand alley wall (poster side)
const POSTER = new THREE.Vector3(WALL_X - 0.03, 2.05, -1.1);
const TARGET = new THREE.Vector3(WALL_X - 0.05, 2.32, -1.0);
const START = new THREE.Vector3(-1.4, 0, -10), STOP = new THREE.Vector3(-1.1, 0, 0.3);

/** Small seeded random generator, so the layout is the same on every render. */
function seeded(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = seeded(1939);

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const span = (t: number, a: number, b: number) => ease((t - a) / (b - a));

/* ------------------------------------------------------------------ textures */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

function brickTexture() {
  return canvasTex(512, 512, (g) => {
    g.fillStyle = "#2a1f1c"; g.fillRect(0, 0, 512, 512);
    const bw = 64, bh = 28;
    for (let r = 0; r < 512 / bh + 1; r++) for (let c = -1; c < 512 / bw + 1; c++) {
      const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh, v = 40 + Math.random() * 30;
      g.fillStyle = `rgb(${v + 30},${v * 0.55},${v * 0.45})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; g.fillRect(x + Math.random() * bw, y + Math.random() * bh, 3, 2); }
    }
    const grd = g.createLinearGradient(0, 0, 0, 512); grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(1, "rgba(0,0,0,0.35)");
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  }, [6, 3]);
}

function windowsTexture() {
  return canvasTex(256, 512, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 512; y += 22) for (let x = 8; x < 256; x += 18) {
      if (Math.random() < 0.28) { g.fillStyle = Math.random() < 0.7 ? "#ffcf7a" : "#9fd3ff"; g.globalAlpha = 0.5 + Math.random() * 0.5; g.fillRect(x, y, 10, 13); }
    }
    g.globalAlpha = 1;
  });
}

/** The poster: a weathered wanted-style bill with the name huge across it. */
function posterTexture(name: string, role: string) {
  return canvasTex(768, 1024, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, 1024); bg.addColorStop(0, "#e9dcc0"); bg.addColorStop(1, "#cdb994");
    g.fillStyle = bg; g.fillRect(0, 0, 768, 1024);
    for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(60,40,20,${Math.random() * 0.08})`; g.fillRect(Math.random() * 768, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    g.fillStyle = "#141414"; g.fillRect(40, 40, 688, 944);
    g.fillStyle = "#b3121b"; g.fillRect(60, 60, 648, 230);
    g.fillStyle = "#f3e7cc"; g.textAlign = "center";
    g.font = "900 64px Impact, 'Arial Black', sans-serif"; g.fillText("THE CITY'S OWN", 384, 150);
    g.font = "700 34px Georgia, serif"; g.fillText("— NIGHT WATCH —", 384, 230);
    // bat silhouette (original shape) behind the name
    g.save(); g.translate(384, 520); g.scale(2.4, 2.4); g.fillStyle = "#2a2a2a";
    g.beginPath(); g.moveTo(0, -18); g.lineTo(8, -30); g.lineTo(10, -14); g.quadraticCurveTo(40, -36, 92, -20); g.quadraticCurveTo(70, -8, 74, 14);
    g.quadraticCurveTo(52, 2, 40, 18); g.quadraticCurveTo(22, 8, 0, 34); g.quadraticCurveTo(-22, 8, -40, 18); g.quadraticCurveTo(-52, 2, -74, 14);
    g.quadraticCurveTo(-70, -8, -92, -20); g.quadraticCurveTo(-40, -36, -10, -14); g.lineTo(-8, -30); g.closePath(); g.fill(); g.restore();
    const n = name.toUpperCase();
    let size = 230; g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`;
    while (g.measureText(n).width > 620 && size > 80) { size -= 8; g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`; }
    g.shadowColor = "rgba(255,40,40,0.55)"; g.shadowBlur = 24; g.fillStyle = "#f6ecd2"; g.fillText(n, 384, 600);
    g.shadowBlur = 0; g.fillStyle = "#b3121b"; g.fillRect(110, 650, 548, 6);
    g.fillStyle = "#f3e7cc"; g.font = "700 46px Georgia, serif"; g.fillText(role.toUpperCase(), 384, 730);
    g.font = "italic 34px Georgia, serif"; g.fillStyle = "#cfc3a6"; g.fillText("Cite & Slayy", 384, 800);
    g.font = "900 30px Impact, sans-serif"; g.fillStyle = "#b3121b"; g.fillText("THE NIGHT IS WATCHED", 384, 930);
    for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.3})`; g.lineWidth = Math.random() * 2; g.beginPath(); const x = Math.random() * 768; g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 80, 1024); g.stroke(); }
  });
}

/* ------------------------------------------------------------------ bat shapes */

function batWingShape() {   // right wing in its own frame: root at x=0, tip at +x
  const s = new THREE.Shape();
  s.moveTo(0, 0.02); s.quadraticCurveTo(0.16, 0.12, 0.36, 0.07); s.quadraticCurveTo(0.3, 0.0, 0.32, -0.08);
  s.quadraticCurveTo(0.24, -0.04, 0.2, -0.1); s.quadraticCurveTo(0.12, -0.04, 0.06, -0.1); s.quadraticCurveTo(0.05, -0.04, 0, -0.04);
  s.closePath();
  return s;
}

function emblemShape() {   // the chest emblem: an angular bat in flight (original design), about 1 unit wide
  const s = new THREE.Shape();
  s.moveTo(0, 0.13); s.lineTo(0.035, 0.2); s.lineTo(0.05, 0.11); s.lineTo(0.16, 0.16); s.lineTo(0.5, 0.17);
  s.lineTo(0.4, 0.06); s.lineTo(0.41, -0.06); s.lineTo(0.31, -0.02); s.lineTo(0.25, -0.12); s.lineTo(0.17, -0.05);
  s.lineTo(0.07, -0.08); s.lineTo(0, -0.22);
  s.lineTo(-0.07, -0.08); s.lineTo(-0.17, -0.05); s.lineTo(-0.25, -0.12); s.lineTo(-0.31, -0.02); s.lineTo(-0.41, -0.06);
  s.lineTo(-0.4, 0.06); s.lineTo(-0.5, 0.17); s.lineTo(-0.16, 0.16); s.lineTo(-0.05, 0.11); s.lineTo(-0.035, 0.2); s.closePath();
  return s;
}

function glowTexture() {
  return canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.18, "rgba(220,235,255,0.75)"); r.addColorStop(0.5, "rgba(150,190,255,0.18)"); r.addColorStop(1, "rgba(120,160,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
}

function dartShape() {      // a flat, bat-winged throwing dart (original design)
  const s = new THREE.Shape();
  s.moveTo(0, 0.05); s.lineTo(0.03, 0.09); s.lineTo(0.04, 0.035); s.quadraticCurveTo(0.12, 0.08, 0.2, 0.02); s.quadraticCurveTo(0.15, 0.0, 0.16, -0.05);
  s.quadraticCurveTo(0.1, -0.02, 0.07, -0.06); s.quadraticCurveTo(0.03, -0.03, 0, -0.1);
  s.quadraticCurveTo(-0.03, -0.03, -0.07, -0.06); s.quadraticCurveTo(-0.1, -0.02, -0.16, -0.05); s.quadraticCurveTo(-0.15, 0, -0.2, 0.02);
  s.quadraticCurveTo(-0.12, 0.08, -0.04, 0.035); s.lineTo(-0.03, 0.09); s.closePath();
  return s;
}

/** A swarm of bats: instanced bodies and wings, each bat on its own curved flight path. */
function Bats({ clock, from, at, count, spread, speed }: { clock: React.RefObject<number>; from: THREE.Vector3; at: number; count: number; spread: number; speed: number }) {
  const body = useRef<THREE.InstancedMesh>(null), lw = useRef<THREE.InstancedMesh>(null), rw = useRef<THREE.InstancedMesh>(null);
  const wingGeo = useMemo(() => new THREE.ShapeGeometry(batWingShape()), []);
  const bats = useMemo(() => Array.from({ length: count }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    return {
      delay: rnd() * 0.9, phase: rnd() * 6, rate: 15 + rnd() * 8, size: 0.6 + rnd() * 0.7,
      dir: new THREE.Vector3(Math.cos(a) * spread * (0.4 + rnd()), 0.35 + rnd() * 0.9, 0.6 + rnd() * 1.2).normalize(),
      wobble: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), i,
    };
  }), [count, spread]);
  const m = useMemo(() => ({ o: new THREE.Object3D(), p: new THREE.Vector3(), q: new THREE.Quaternion(), look: new THREE.Matrix4(), up: new THREE.Vector3(0, 1, 0) }), []);
  useFrame(() => {
    const t = clock.current - at;
    for (const b of bats) {
      const lt = t - b.delay, alive = lt > 0 && lt < 4.5;
      const s = alive ? b.size * 0.95 : 0;
      const dist = Math.max(0, lt) * speed * (1 + Math.max(0, lt) * 0.35);
      m.p.copy(from).addScaledVector(b.dir, dist).addScaledVector(b.wobble, Math.sin(lt * 3 + b.phase) * 0.35);
      m.look.lookAt(m.p.clone().add(b.dir), m.p, m.up); m.q.setFromRotationMatrix(m.look);
      m.o.position.copy(m.p); m.o.quaternion.copy(m.q); m.o.scale.setScalar(s); m.o.rotation.z += Math.sin(lt * 2 + b.phase) * 0.3;
      m.o.updateMatrix(); body.current!.setMatrixAt(b.i, m.o.matrix);
      const flap = Math.sin(lt * b.rate + b.phase) * 0.9;
      for (const [ref, side] of [[rw, 1], [lw, -1]] as const) {
        m.o.position.copy(m.p); m.o.quaternion.copy(m.q); m.o.scale.set(s * side, s, s);
        m.o.rotateY(Math.PI / 2); m.o.rotateX(-Math.PI / 2); m.o.rotateY(flap * side * -1); m.o.updateMatrix();
        ref.current!.setMatrixAt(b.i, m.o.matrix);
      }
    }
    for (const r of [body, lw, rw]) r.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={body} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.05, 8, 6]} /><meshStandardMaterial color="#1d1a24" emissive="#0c0a14" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={lw} args={[wingGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color="#221d2a" emissive="#0c0a14" roughness={0.85} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={rw} args={[wingGeo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color="#221d2a" emissive="#0c0a14" roughness={0.85} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------------------------------------------ the figure */

const SUIT: Record<string, { color: string; rough: number; metal?: number; glow?: string }> = {
  Shirt: { color: "#1b1d23", rough: 0.45, metal: 0.35 }, Pants: { color: "#121318", rough: 0.6 }, Socks: { color: "#0b0b0d", rough: 0.5 },
  Skin: { color: "#151517", rough: 0.55 }, Hair: { color: "#0b0b0c", rough: 0.7 }, Eyes: { color: "#0b0b0d", rough: 0.5 },
};

function Figure({ clock, cue, onHand, visible }: { clock: React.RefObject<number>; cue: (c: KnightCue) => void; onHand: React.RefObject<THREE.Vector3>; visible: React.RefObject<number> }) {
  const { scene, animations } = useGLTF(MAN_URL);
  const root = useRef<THREE.Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(scene);
    m.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.frustumCulled = false;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((src) => {
        const look = SUIT[src.name] ?? SUIT.Shirt;
        return new THREE.MeshStandardMaterial({ name: src.name, color: look.color, roughness: look.rough, metalness: look.metal ?? 0.1,
          emissive: look.glow ?? "#000", emissiveIntensity: look.glow ? 2.6 : 0 });
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
    });
    // measure from the skeleton (skinned-mesh bounds are unreliable in bind pose)
    m.updateMatrixWorld(true);
    const top = m.getObjectByName("Head_end")!.getWorldPosition(new THREE.Vector3()), foot = m.getObjectByName("FootL")!.getWorldPosition(new THREE.Vector3());
    m.scale.multiplyScalar(FIGURE_HEIGHT / Math.max(0.001, top.y - Math.min(0, foot.y)));
    return m;
  }, [scene]);
  const { actions } = useAnimations(animations, model);
  const bones = useMemo(() => {
    const get = (n: string) => model.getObjectByName(n)!;
    return { head: get("Head"), top: get("Head_end"), sl: get("ShoulderL"), sr: get("ShoulderR"), neck: get("Neck"), hips: get("Hips"), hand: get("PalmR"), torso: get("Torso") };
  }, [model]);

  // cape: a cloth grid recomputed in world space every frame from the shoulders
  const COLS = 12, ROWS = 16;
  const cape = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, COLS, ROWS);
    return g;
  }, []);
  const cowl = useRef<THREE.Group>(null), emblem = useRef<THREE.Group>(null);
  const emblemGeo = useMemo(() => { const g = new THREE.ExtrudeGeometry(emblemShape(), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 }); g.center(); return g; }, []);
  const glow = useMemo(() => glowTexture(), []);
  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), h: new THREE.Vector3(), e: new THREE.Vector3(),
    fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  const state = useRef({ phase: "idle", steps: 0, speed: 0, lastX: 0 });

  useEffect(() => {
    const walk = actions["HumanArmature|Man_Walk"], idle = actions["HumanArmature|Man_Idle"];
    walk?.reset().play(); if (walk) walk.timeScale = 0.95;
    idle?.play(); if (idle) idle.weight = 0;
  }, [actions]);

  useFrame((_, dt) => {
    const t = clock.current, r = root.current; if (!r) return;
    const walk = actions["HumanArmature|Man_Walk"], idle = actions["HumanArmature|Man_Idle"], slash = actions["HumanArmature|Man_SwordSlash"];
    const st = state.current;
    // path: out of the dark alley towards the camera, then turn to face the poster wall
    const u = span(t, T_WALK, T_STOP);
    r.position.lerpVectors(START, STOP, u * 0.85 + ease(u) * 0.15);
    const turn = span(t, T_STOP - 0.35, T_THROW + 0.1);
    r.rotation.y = turn * (Math.PI / 2 - 0.25);
    st.speed = (r.position.z - st.lastX) / Math.max(dt, 1e-3); st.lastX = r.position.z;
    if (t < T_STOP && walk && idle) { walk.weight = 1; idle.weight = 0; }
    if (t >= T_STOP && st.phase === "idle" && walk && idle) { walk.fadeOut(0.3); idle.reset().fadeIn(0.3).play(); st.phase = "stopped"; }
    if (t >= T_THROW && st.phase === "stopped" && slash) {
      slash.reset(); slash.setLoop(THREE.LoopOnce, 1); slash.clampWhenFinished = true; slash.timeScale = 1.15; slash.fadeIn(0.12).play();
      idle?.fadeOut(0.12); st.phase = "throw"; cue("throw");
    }
    if (t >= T_THROW + 1.0 && st.phase === "throw" && idle && slash) { slash.fadeOut(0.4); idle.reset().fadeIn(0.4).play(); st.phase = "after"; }
    // footsteps
    if (t > T_WALK && t < T_STOP) { const n = Math.floor((t - T_WALK) / 0.52); if (n > st.steps) { st.steps = n; cue("step"); } }
    // vanish into the bats
    const vis = visible.current;
    r.visible = vis > 0.02; r.scale.setScalar(0.92 + vis * 0.08);

    r.updateMatrixWorld(true);
    bones.hand.getWorldPosition(onHand.current);
    // body frame
    // facing comes from the skeleton itself (the idle clip turns the torso), not just the root rotation
    bones.sl.getWorldPosition(tmp.a); bones.sr.getWorldPosition(tmp.b); bones.neck.getWorldPosition(tmp.c);
    tmp.right.subVectors(tmp.b, tmp.a).setY(0);
    if (tmp.right.lengthSq() < 1e-8) tmp.right.set(-Math.cos(r.rotation.y), 0, Math.sin(r.rotation.y));
    tmp.right.normalize();
    tmp.fwd.crossVectors(tmp.right, tmp.up).negate().normalize();
    const yaw = Math.atan2(tmp.fwd.x, tmp.fwd.z);
    // cowl with pointed ears
    bones.head.getWorldPosition(tmp.h); bones.top.getWorldPosition(tmp.e);
    if (cowl.current) {
      const hs = tmp.h.distanceTo(tmp.e);
      cowl.current.position.copy(tmp.h).lerp(tmp.e, 0.5);
      cowl.current.quaternion.setFromAxisAngle(tmp.up, yaw);
      cowl.current.scale.setScalar(0.27 + hs * 0);   // big enough to enclose the stylised head
      cowl.current.visible = r.visible;
    }
    // gold emblem on the chest, between the torso and neck joints, just in front of the suit
    if (emblem.current) {
      bones.torso.getWorldPosition(tmp.p);
      emblem.current.position.copy(tmp.p).lerp(tmp.c, 0.62).addScaledVector(tmp.fwd, 0.135);
      emblem.current.quaternion.setFromAxisAngle(tmp.up, yaw);
      emblem.current.visible = r.visible;
    }
    // cape vertices
    const pos = cape.attributes.position as THREE.BufferAttribute;
    const len = 1.32, wind = Math.min(1, Math.abs(st.speed) * 0.9);
    const throwKick = st.phase === "throw" ? Math.sin(Math.min(1, (t - T_THROW) / 0.8) * Math.PI) : 0;
    for (let row = 0; row <= ROWS; row++) {
      const v = row / ROWS;
      for (let col = 0; col <= COLS; col++) {
        const s = col / COLS, i = row * (COLS + 1) + col;
        tmp.p.lerpVectors(tmp.b, tmp.a, s).addScaledVector(tmp.right, (s - 0.5) * 0.22);   // across (and just past) the shoulders
        tmp.p.y += -Math.sin(s * Math.PI) * 0.0 + 0.02;
        const flare = (s - 0.5) * (0.7 * v + 0.25 * v * v);
        const back = 0.1 + v * (0.16 + wind * 0.45 + throwKick * 0.45) + Math.sin(t * 5.5 + v * 4 + s * 3) * 0.035 * v + Math.sin(t * 2.1 + s * 6) * 0.02 * v;
        tmp.p.addScaledVector(tmp.right, flare).addScaledVector(tmp.fwd, -back);
        tmp.p.y -= v * len * (1 - wind * 0.12);
        tmp.p.addScaledVector(tmp.right, Math.sin(t * 3.3 + v * 5) * 0.03 * v);
        pos.setXYZ(i, tmp.p.x, tmp.p.y, tmp.p.z);
      }
    }
    pos.needsUpdate = true; cape.computeVertexNormals(); cape.computeBoundingSphere();
  });

  return (
    <>
      <group ref={root}><primitive object={model} /></group>
      <mesh geometry={cape} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#0d0d12" roughness={0.78} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <group ref={cowl}>
        <mesh position={[0, 0.02, -0.02]} scale={[0.5, 0.64, 0.56]}><sphereGeometry args={[1, 24, 18]} /><meshStandardMaterial color="#14151a" roughness={0.4} metalness={0.3} /></mesh>
        {[-1, 1].map((sx) => (
          <mesh key={sx} position={[sx * 0.27, 0.72, -0.04]} rotation-z={-sx * 0.1}><coneGeometry args={[0.09, 0.5, 12]} /><meshStandardMaterial color="#14151a" roughness={0.4} metalness={0.3} /></mesh>
        ))}
        {[-1, 1].map((sx) => (
          <group key={`e${sx}`} position={[sx * 0.19, 0.1, 0.6]} rotation-z={sx * 0.22}>
            <mesh><boxGeometry args={[0.22, 0.055, 0.04]} /><meshBasicMaterial color={[5, 5.2, 6]} toneMapped={false} /></mesh>
            <sprite scale={[0.6, 0.32, 1]}><spriteMaterial map={glow} color="#d8e6ff" transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></sprite>
          </group>
        ))}
        {/* sculpted brow and cheek plates so the mask reads as armour, not a ball */}
        <mesh position={[0, 0.2, 0.42]} rotation-x={-0.35} scale={[0.5, 0.1, 0.16]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#1a1c22" roughness={0.35} metalness={0.5} /></mesh>
        <mesh position={[0, -0.22, 0.36]} scale={[0.36, 0.2, 0.22]}><sphereGeometry args={[1, 16, 10]} /><meshStandardMaterial color="#232020" roughness={0.6} metalness={0.1} /></mesh>
      </group>
      <group ref={emblem}>
        <mesh geometry={emblemGeo} scale={0.25}><meshStandardMaterial color="#f5b70f" emissive="#ff9d00" emissiveIntensity={0.75} metalness={0.8} roughness={0.3} /></mesh>
      </group>
    </>
  );
}

/* ------------------------------------------------------------------ the dart, poster and set */

function Dart({ clock, hand, cue, onHit }: { clock: React.RefObject<number>; hand: React.RefObject<THREE.Vector3>; cue: (c: KnightCue) => void; onHit: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(dartShape(), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    g.center(); return g;
  }, []);
  const from = useRef(new THREE.Vector3()), hit = useRef(false), launched = useRef(false);
  useFrame(() => {
    const t = clock.current, g = ref.current; if (!g) return;
    if (t < T_RELEASE) { g.visible = false; return; }
    if (!launched.current) { launched.current = true; from.current.copy(hand.current); }
    g.visible = true;
    const u = Math.min(1, (t - T_RELEASE) / (T_HIT - T_RELEASE));
    g.position.lerpVectors(from.current, TARGET, u); g.position.y += Math.sin(u * Math.PI) * 0.25;
    if (u < 1) {
      g.rotation.set(Math.PI / 2 - 0.15, 0, -(t - T_RELEASE) * 34);   // flat and spinning
    } else {
      g.rotation.set(0.25, -Math.PI / 2 + 0.2, 0.5);                   // stuck in the wall at an angle
      g.position.x = TARGET.x - 0.04;
      if (!hit.current) { hit.current = true; cue("hit"); onHit(); }
    }
  });
  return (
    <group ref={ref} visible={false} scale={2}>
      <mesh geometry={geo} castShadow><meshStandardMaterial color="#1a1c22" metalness={0.9} roughness={0.28} /></mesh>
    </group>
  );
}

function Sparks({ clock }: { clock: React.RefObject<number> }) {
  const ref = useRef<THREE.Points>(null);
  const N = 70;
  const data = useMemo(() => {
    const pos = new Float32Array(N * 3), vel = Array.from({ length: N }, () => new THREE.Vector3(-(0.5 + rnd() * 2.2), rnd() * 2.4 - 0.4, (rnd() - 0.5) * 2.4));
    return { pos, vel };
  }, []);
  useFrame(() => {
    const t = clock.current - T_HIT, p = ref.current; if (!p) return;
    p.visible = t > 0 && t < 0.9;
    if (!p.visible) return;
    for (let i = 0; i < N; i++) {
      const v = data.vel[i];
      data.pos[i * 3] = TARGET.x - 0.05 + v.x * t; data.pos[i * 3 + 1] = TARGET.y + v.y * t - 4.9 * t * t; data.pos[i * 3 + 2] = TARGET.z + v.z * t;
    }
    (p.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (p.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t / 0.9);
  });
  return (
    <points ref={ref} visible={false} frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[data.pos, 3]} /></bufferGeometry>
      <pointsMaterial color="#ffd27a" size={0.045} transparent toneMapped={false} />
    </points>
  );
}

function Rain() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 1100;
  const drops = useMemo(() => Array.from({ length: N }, () => new THREE.Vector3((rnd() - 0.5) * 16, rnd() * 12, -14 + rnd() * 22)), []);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    for (let i = 0; i < N; i++) {
      const d = drops[i]; d.y -= 15 * Math.min(dt, 0.05); d.x -= 1.2 * Math.min(dt, 0.05);
      if (d.y < 0) { d.y = 11 + rnd(); d.x = (rnd() - 0.5) * 16; }
      o.position.copy(d); o.rotation.z = 0.08; o.updateMatrix(); ref.current!.setMatrixAt(i, o.matrix);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}>
      <boxGeometry args={[0.006, 0.32, 0.006]} /><meshBasicMaterial color="#9fb2cf" transparent opacity={0.32} depthWrite={false} />
    </instancedMesh>
  );
}

function Skyline() {
  const tex = useMemo(() => windowsTexture(), []);
  const blocks = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ x: -26 + i * 3.6 + rnd(), h: 10 + rnd() * 22, w: 2.6 + rnd() * 1.6, z: -34 - rnd() * 10 })), []);
  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={[b.x, b.h / 2, b.z]}>
          <boxGeometry args={[b.w, b.h, 2.5]} />
          <meshStandardMaterial color="#07090e" emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.55} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Alley({ name, role, lit }: { name: string; role: string; lit: React.RefObject<number> }) {
  const brick = useMemo(() => brickTexture(), []);
  const poster = useMemo(() => posterTexture(name, role), [name, role]);
  const lamp = useRef<THREE.SpotLight>(null), bulb = useRef<THREE.MeshBasicMaterial>(null);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.copy(POSTER); return o; }, []);
  useFrame(() => {
    const k = lit.current;
    if (lamp.current) lamp.current.intensity = 4 + k * 26;
    if (bulb.current) bulb.current.color.setScalar(0.4 + k * 1.6);
  });
  return (
    <group>
      {/* wet street */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -6]} receiveShadow>
        <planeGeometry args={[30, 40]} />
        <MeshReflectorMaterial resolution={512} mixBlur={1} mixStrength={3.2} blur={[260, 90]} mirror={0.8} color="#0b0d12" roughness={0.55} metalness={0.4} depthScale={0} />
      </mesh>
      {/* alley walls */}
      <mesh position={[WALL_X + 0.25, 4, -6]} receiveShadow><boxGeometry args={[0.5, 8, 26]} /><meshStandardMaterial map={brick} color="#8a7a74" roughness={0.92} /></mesh>
      <mesh position={[-4.6, 4.5, -6]} receiveShadow><boxGeometry args={[0.5, 9, 26]} /><meshStandardMaterial map={brick} color="#6c615c" roughness={0.92} /></mesh>
      {/* fire escape on the left wall */}
      {[2.6, 5.1].map((y) => (
        <group key={y} position={[-4.05, y, -5]}>
          <mesh><boxGeometry args={[0.8, 0.05, 3]} /><meshStandardMaterial color="#1c1d21" metalness={0.7} roughness={0.5} /></mesh>
          <mesh position={[0.38, 0.45, 0]}><boxGeometry args={[0.03, 0.9, 3]} /><meshStandardMaterial color="#1c1d21" metalness={0.7} roughness={0.5} wireframe /></mesh>
        </group>
      ))}
      {/* the poster, its frame of grime, and the lamp above it */}
      <mesh position={POSTER} rotation-y={-Math.PI / 2}><planeGeometry args={[1.5, 2.0]} /><meshStandardMaterial map={poster} roughness={0.85} /></mesh>
      <mesh position={[WALL_X - 0.12, 3.55, POSTER.z]}><cylinderGeometry args={[0.03, 0.03, 0.3]} /><meshStandardMaterial color="#222" metalness={0.8} /></mesh>
      <mesh position={[WALL_X - 0.3, 3.45, POSTER.z]} rotation-z={Math.PI / 2}><coneGeometry args={[0.16, 0.2, 16, 1, true]} /><meshStandardMaterial color="#1e1f22" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} /></mesh>
      <mesh position={[WALL_X - 0.33, 3.38, POSTER.z]}><sphereGeometry args={[0.05, 12, 8]} /><meshBasicMaterial ref={bulb} color="#ffcf8a" toneMapped={false} /></mesh>
      <primitive object={target} />
      <LampBeam lit={lit} />
      <spotLight ref={lamp} position={[WALL_X - 0.4, 3.4, POSTER.z]} target={target} angle={0.62} penumbra={0.6} distance={7} decay={1.6} color="#ffbd6e" castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} />
      {/* steam from a grate */}
      <Steam />
      <Skyline />
      {/* moon */}
      <mesh position={[-6, 15, -40]}><sphereGeometry args={[3.2, 32, 24]} /><meshBasicMaterial color="#e8eeff" toneMapped={false} /></mesh>
      <MoonHalo />
      <Splashes />
    </group>
  );
}

/** A soft cone of light under the lamp, brightening when the lamp comes on. */
function LampBeam({ lit }: { lit: React.RefObject<number> }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uK: { value: 0.1 }, uColor: { value: new THREE.Color("#ffbd6e") } }), []);
  useFrame(() => { if (mat.current) mat.current.uniforms.uK.value = 0.12 + lit.current * 0.88; });
  return (
    <mesh position={[WALL_X - 0.55, 2.35, POSTER.z]} rotation-z={-0.22}>
      <coneGeometry args={[0.95, 2.2, 32, 1, true]} />
      <shaderMaterial ref={mat} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} uniforms={uniforms}
        vertexShader={"varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv=uv; vec4 w=modelViewMatrix*vec4(position,1.); vN=normalMatrix*normal; vV=-w.xyz; gl_Position=projectionMatrix*w; }"}
        fragmentShader={"uniform float uK; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vec3 n=length(vN)>1e-5?normalize(vN):vec3(0.,0.,1.); vec3 v=length(vV)>1e-5?normalize(vV):vec3(0.,0.,1.); float edge=pow(clamp(abs(dot(n,v)),0.,1.),1.6); float fall=pow(clamp(vUv.y,0.,1.),1.4); gl_FragColor=vec4(uColor*edge*fall*0.16*uK, 1.); }"} />
    </mesh>
  );
}

function MoonHalo() {
  const tex = useMemo(() => glowTexture(), []);
  return <sprite position={[-6, 15, -39]} scale={[22, 22, 1]}><spriteMaterial map={tex} color="#9fb4ff" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>;
}

/** Raindrops landing on the wet street: little rings that spread and fade. */
function Splashes() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 70;
  const drops = useMemo(() => Array.from({ length: N }, () => ({ x: (rnd() - 0.5) * 9, z: -8 + rnd() * 11, age: rnd() })), []);
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, dt) => {
    for (let i = 0; i < N; i++) {
      const d = drops[i]; d.age += Math.min(dt, 0.05) * 2.4;
      if (d.age > 1) { d.age = 0; d.x = (Math.random() - 0.5) * 9; d.z = -8 + Math.random() * 11; }
      o.position.set(d.x, 0.012, d.z); o.rotation.set(-Math.PI / 2, 0, 0); o.scale.setScalar(0.02 + d.age * 0.11); o.updateMatrix();
      ref.current!.setMatrixAt(i, o.matrix);
    }
    ref.current!.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, N]} frustumCulled={false}>
      <ringGeometry args={[0.8, 1, 24]} /><meshBasicMaterial color="#9fb2cf" transparent opacity={0.22} depthWrite={false} />
    </instancedMesh>
  );
}

function Steam() {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62); r.addColorStop(0, "rgba(200,210,230,0.55)"); r.addColorStop(1, "rgba(200,210,230,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  }), []);
  const puffs = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ off: i / 14, x: (rnd() - 0.5) * 0.4 })), []);
  useFrame(({ clock }) => {
    ref.current?.children.forEach((c, i) => {
      const k = (clock.elapsedTime * 0.22 + puffs[i].off) % 1;
      c.position.set(2.7 + puffs[i].x + k * 0.3, 0.05 + k * 2.2, -6.5);
      c.scale.setScalar(0.35 + k * 1.1);
      ((c as THREE.Sprite).material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.06;
    });
  });
  return (
    <group ref={ref}>
      {puffs.map((_, i) => <sprite key={i}><spriteMaterial map={tex} transparent depthWrite={false} opacity={0} /></sprite>)}
    </group>
  );
}

/* ------------------------------------------------------------------ direction */

type Shot = { t: number; pos: [number, number, number]; look: [number, number, number] };
// low hero shot, close-up on the eyes and emblem, over the shoulder for the throw, then in on the poster
const SHOTS: Shot[] = [
  { t: 0, pos: [0.3, 1.35, 6.4], look: [-1.3, 1.7, -6] },
  { t: 3.6, pos: [0.5, 1.15, 4.4], look: [-1.1, 1.45, -0.2] },
  { t: 4.4, pos: [-0.75, 1.62, 1.75], look: [-1.1, 1.62, 0.3] },
  { t: 4.95, pos: [-0.8, 1.58, 1.95], look: [-1.1, 1.55, 0.3] },
  { t: 5.3, pos: [-3.7, 1.65, 4.3], look: [1.0, 1.55, -0.6] },
  { t: 6.2, pos: [-1.6, 1.8, 2.9], look: [3.6, 2.2, -1.0] },
  { t: 8.0, pos: [1.6, 1.85, 1.7], look: [WALL_X, 2.1, -1.05] },
  { t: 10.4, pos: [2.25, 2.0, 0.55], look: [WALL_X, 2.1, -1.08] },
];

function Director({ clock, shake }: { clock: React.RefObject<number>; shake: React.RefObject<number> }) {
  const { camera } = useThree();
  const a = useMemo(() => new THREE.Vector3(), []), b = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const t = clock.current;
    let i = 0; while (i < SHOTS.length - 2 && t > SHOTS[i + 1].t) i++;
    const s0 = SHOTS[i], s1 = SHOTS[i + 1], k = ease((t - s0.t) / (s1.t - s0.t));
    a.fromArray(s0.pos).lerp(b.fromArray(s1.pos), k); camera.position.copy(a);
    a.fromArray(s0.look).lerp(b.fromArray(s1.look), k);
    shake.current = Math.max(0, shake.current - dt * 2.4);
    const sh = shake.current * shake.current * 0.06;
    camera.position.x += Math.sin(t * 61) * sh; camera.position.y += Math.cos(t * 53) * sh;
    camera.lookAt(a);
  });
  return null;
}

function Scene({ name, role, sound }: { name: string; role: string; sound: React.RefObject<KnightSound | null> }) {
  const clock = useRef(0), started = useRef(false), fired = useRef<Set<string>>(new Set());
  const hand = useRef(new THREE.Vector3()), lit = useRef(0), shake = useRef(0), visible = useRef(1);
  const moon = useRef<THREE.DirectionalLight>(null), sky = useRef<THREE.HemisphereLight>(null);
  const cue = (c: KnightCue) => sound.current?.cue(c);
  const vanishFrom = useRef(new THREE.Vector3(-1.1, 1.2, 0.3));
  useFrame((_, dt) => {
    if (!started.current) { started.current = true; clock.current = 0; }
    clock.current += Math.min(dt, 0.05);
    const t = clock.current;
    const once = (key: string, at: number, fn: () => void) => { if (t >= at && !fired.current.has(key)) { fired.current.add(key); fn(); } };
    once("bats", T_BATS, () => cue("bats"));
    once("thunder", T_THUNDER, () => { cue("thunder"); });
    once("vanish", T_VANISH, () => { cue("vanish"); vanishFrom.current.set(hand.current.x, 1.1, hand.current.z); });
    // lightning: two quick flashes
    const fl = (x: number) => Math.max(0, 1 - Math.abs(x) / 0.06);
    const flash = fl(t - T_THUNDER) + 0.7 * fl(t - T_THUNDER - 0.16) + 0.5 * fl(t - 8.2);
    if (moon.current) moon.current.intensity = 1.1 + flash * 9;
    if (sky.current) sky.current.intensity = 0.32 + flash * 3;
    // lamp: dim, a nervous flicker as the dart flies, then full on at the hit
    lit.current = t < T_RELEASE ? 0.08 : t < T_HIT ? 0.08 + (Math.sin(t * 47) > 0.2 ? 0.25 : 0) : Math.min(1, lit.current + dt * 5);
    visible.current = t < T_VANISH + 0.25 ? 1 : Math.max(0, visible.current - dt * 3.5);
  });
  return (
    <>
      <color attach="background" args={["#141c30"]} />
      <fog attach="fog" args={["#162036", 4, 30]} />
      <hemisphereLight ref={sky} args={["#3c4c70", "#0b0b10", 0.32]} />
      <directionalLight ref={moon} position={[-6, 12, -14]} intensity={1.1} color="#a9bfff" castShadow shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-4} shadow-bias={-0.0005} />
      {/* rim light from deep in the alley so the figure reads as a silhouette */}
      <pointLight position={[-1.3, 2.6, -8]} intensity={9} distance={10} color="#7f9cff" />
      <pointLight position={[2.5, 0.4, 2.5]} intensity={1.2} distance={6} color="#ff9a55" />
      {/* cold rim light behind the throwing position so his outline and cape edge catch the light */}
      <spotLight position={[-2.2, 3.4, -3.2]} angle={0.5} penumbra={0.8} intensity={22} distance={9} decay={1.6} color="#8fa8ff" target-position={[-1.1, 1, 0.3]} />
      <Alley name={name} role={role} lit={lit} />
      <Rain />
      <Suspense fallback={null}>
        <Figure clock={clock} cue={cue} onHand={hand} visible={visible} />
      </Suspense>
      <Dart clock={clock} hand={hand} cue={cue} onHit={() => { shake.current = 1; }} />
      <Sparks clock={clock} />
      <Bats clock={clock} from={new THREE.Vector3(-1.4, 2.2, -9)} at={T_BATS} count={90} spread={1.4} speed={3.2} />
      <BatsAt clock={clock} origin={vanishFrom} />
      <Director clock={clock} shake={shake} />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.62} luminanceSmoothing={0.2} />
        <Vignette eskil={false} offset={0.22} darkness={0.72} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

/** The second swarm, which bursts from wherever the figure is standing when he vanishes. */
function BatsAt({ clock, origin }: { clock: React.RefObject<number>; origin: React.RefObject<THREE.Vector3> }) {
  return <Bats clock={clock} from={origin.current} at={T_VANISH} count={60} spread={2.2} speed={2.6} />;
}

useGLTF.preload(MAN_URL);

/** Full-screen easter egg overlay; closes itself at the end (or on click / Escape). */
export default function NightWatch({ onDone, name, role = "" }: { onDone: () => void; name: string; role?: string }) {
  const [open, setOpen] = useState(true);
  const [muted, setMuted] = useState(false);
  const sound = useRef<KnightSound | null>(null);
  const first = name.split(" ")[0] || name;
  useEffect(() => {
    sound.current = startKnightSound();
    return () => { sound.current?.stop(); sound.current = null; };
  }, []);
  useEffect(() => { if (!open) sound.current?.stop(); }, [open]);
  useEffect(() => {
    const t = window.setTimeout(() => setOpen(false), DURATION * 1000 + 600);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(t); window.removeEventListener("keydown", key); };
  }, []);
  return (
    <AnimatePresence onExitComplete={onDone}>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[100] cursor-pointer bg-[#05070c]" onClick={() => setOpen(false)} role="dialog" aria-label="Easter egg: the night watch">
          <Canvas shadows camera={{ position: [0.4, 1.25, 7.6], fov: 38, far: 200 }} dpr={[1, 1.5]} gl={{ antialias: false, toneMapping: THREE.NoToneMapping }}>
            <Scene name={first} role={role} sound={sound} />
          </Canvas>
          {/* letterbox bars for the cinematic frame */}
          <motion.div initial={{ height: 0 }} animate={{ height: "9vh" }} transition={{ duration: 1.1, ease: "easeOut" }} className="pointer-events-none absolute inset-x-0 top-0 bg-black" />
          <motion.div initial={{ height: 0 }} animate={{ height: "9vh" }} transition={{ duration: 1.1, ease: "easeOut" }} className="pointer-events-none absolute inset-x-0 bottom-0 bg-black" />
          <motion.div initial={{ opacity: 0, y: 12, letterSpacing: "0.6em" }} animate={{ opacity: 1, y: 0, letterSpacing: "0.32em" }} transition={{ delay: T_HIT + 0.5, duration: 1.4, ease: "easeOut" }}
            className="pointer-events-none absolute inset-x-0 bottom-[11vh] text-center font-display text-xl font-extrabold uppercase text-[#f3e7cc] drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] md:text-3xl">
            The night belongs to {first}
          </motion.div>
          <button onClick={(e) => { e.stopPropagation(); if (muted) { sound.current = startKnightSound(); setMuted(false); } else { sound.current?.stop(); sound.current = null; setMuted(true); } }}
            aria-label={muted ? "Sound on" : "Mute"} className="btn-brut absolute right-5 top-[10.5vh] grid size-10 place-items-center rounded-xl bg-surface text-ink">
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <div className="pointer-events-none absolute bottom-[3vh] inset-x-0 text-center text-xs font-bold text-white/50">You found a secret · click to close</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
