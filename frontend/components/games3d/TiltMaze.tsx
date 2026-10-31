"use client";
/* eslint-disable react-hooks/immutability -- game state lives in a ref and is mutated per frame inside useFrame (the standard R3F loop) */

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { useRef, useState } from "react";
import type { Group, Mesh } from "three";
import { usePersistent } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Glow, useSparks } from "./fx";
import { GameFrame, type Phase } from "./GameFrame";
import { useTex, woodTexture } from "./scenery";

const tableWood = () => woodTexture("#3a2a1c");
const trayWood = () => woodTexture("#6b4428");
const wallWood = () => woodTexture("#9a6a40");

type Wall = [number, number, number, number];   // center x, center z, width (x), depth (z)
const T = 0.16, BALL = 0.22, G = 11, MAX_V = 5.5, STEP = 0.04;   // STEP: max distance per physics sub-step (< wall thickness)

/** Perfect maze by recursive backtracking; returns wall boxes in board coordinates (cells are 1×1, board centred). */
function makeMaze(n: number): { walls: Wall[]; start: [number, number]; goal: [number, number]; stars: [number, number][] } {
  const right = Array.from({ length: n }, () => Array(n).fill(true));
  const down = Array.from({ length: n }, () => Array(n).fill(true));
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([di, dj]) => [i + di, j + dj] as const)
      .filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && !seen[a][b]);
    if (!nb.length) { stack.pop(); continue; }
    const [a, b] = nb[Math.floor(Math.random() * nb.length)];
    if (a > i) right[i][j] = false; else if (a < i) right[a][b] = false; else if (b > j) down[i][j] = false; else down[a][b] = false;
    seen[a][b] = true;
    stack.push([a, b]);
  }
  const o = (n - 1) / 2;
  const walls: Wall[] = [[-n / 2, 0, T, n + T], [n / 2, 0, T, n + T], [0, -n / 2, n + T, T], [0, n / 2, n + T, T]];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (right[i][j] && i < n - 1) walls.push([i - o + 0.5, j - o, T, 1 + T]);
    if (down[i][j] && j < n - 1) walls.push([i - o, j - o + 0.5, 1 + T, T]);
  }
  const cells: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i || j) && (i !== n - 1 || j !== n - 1)) cells.push([i - o, j - o]);
  cells.sort(() => Math.random() - 0.5);
  return { walls, start: [-o, -o], goal: [o, o], stars: cells.slice(0, 3) };
}

const freshState = (lv: number, score: number, m: ReturnType<typeof makeMaze>): State => ({
  x: m.start[0], z: m.start[1], vx: 0, vz: 0, rx: 0, rz: 0, stars: [false, false, false], time: 30 + lv * 8, score, level: lv, won: false });

interface State { x: number; z: number; vx: number; vz: number; rx: number; rz: number; stars: boolean[]; time: number; score: number; level: number; won: boolean }

function Board({ st, maze, phase, onHud, onLevel, onDie }: {
  st: React.RefObject<State>; maze: ReturnType<typeof makeMaze>; phase: Phase; onHud: (s: State) => void; onLevel: () => void; onDie: () => void;
}) {
  const board = useRef<Group>(null), ball = useRef<Mesh>(null), goal = useRef<Group>(null);
  const starRefs = useRef<(Group | null)[]>([]);
  const hud = useRef(0);
  const [sparks, burst] = useSparks();
  const n = Math.round(maze.walls[2][2] - T);
  useFrame((state, raw) => {
    const s = st.current;
    const dt = Math.min(raw, 0.033);
    const trx = phase === "play" ? -state.pointer.y * 0.32 : Math.sin(state.clock.elapsedTime * 0.6) * 0.08;
    const trz = phase === "play" ? -state.pointer.x * 0.32 : Math.cos(state.clock.elapsedTime * 0.5) * 0.08;
    s.rx += (trx - s.rx) * Math.min(1, dt * 8);
    s.rz += (trz - s.rz) * Math.min(1, dt * 8);
    if (phase === "play" && !s.won) {
      s.time -= dt;
      if (s.time <= 0) { s.time = 0; onDie(); }
      s.vx += -Math.sin(s.rz) * G * dt; s.vz += Math.sin(s.rx) * G * dt;
      const damp = Math.exp(-1.1 * dt); s.vx *= damp; s.vz *= damp;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > MAX_V) { s.vx *= MAX_V / sp; s.vz *= MAX_V / sp; }
      // sub-steps so the ball can never jump through a wall in one frame
      const steps = Math.max(1, Math.ceil((Math.max(Math.abs(s.vx), Math.abs(s.vz)) * dt) / STEP));
      const h = dt / steps, lim = n / 2 - T / 2 - BALL;
      for (let k = 0; k < steps; k++) {
        for (const axis of ["x", "z"] as const) {
          const prev = axis === "x" ? s.x : s.z;
          if (axis === "x") s.x += s.vx * h; else s.z += s.vz * h;
          for (const [cx, cz, w, d] of maze.walls) {
            const ox = BALL + w / 2 - Math.abs(s.x - cx), oz = BALL + d / 2 - Math.abs(s.z - cz);
            if (ox <= 0 || oz <= 0) continue;
            // push back to the side the ball came from
            if (axis === "x") { const side = Math.sign(prev - cx) || 1; s.x = cx + side * (w / 2 + BALL + 1e-4); if (Math.abs(s.vx) > 1.6) sfx("tick"); s.vx *= -0.3; }
            else { const side = Math.sign(prev - cz) || 1; s.z = cz + side * (d / 2 + BALL + 1e-4); if (Math.abs(s.vz) > 1.6) sfx("tick"); s.vz *= -0.3; }
          }
        }
        // the frame is solid: never leave the board
        if (Math.abs(s.x) > lim) { s.x = Math.sign(s.x) * lim; s.vx *= -0.3; }
        if (Math.abs(s.z) > lim) { s.z = Math.sign(s.z) * lim; s.vz *= -0.3; }
      }
      maze.stars.forEach(([sx, sz], k) => {
        if (!s.stars[k] && Math.hypot(s.x - sx, s.z - sz) < 0.4) {
          s.stars[k] = true; s.score += 5; burst(sx, 0.4, sz, "#ffd23f", 30); sfx("coin", k / 3);
        }
      });
      if (Math.hypot(s.x - maze.goal[0], s.z - maze.goal[1]) < 0.35) {
        s.won = true; s.score += 10 + Math.round(s.time / 3); burst(s.x, 0.4, s.z, "#c6f24e", 70); sfx("combo");
        onLevel();
      }
      hud.current += dt;
      if (hud.current > 0.1) { hud.current = 0; onHud({ ...s }); }
    }
    if (board.current) { board.current.rotation.x = s.rx; board.current.rotation.z = s.rz; }
    if (ball.current) {
      ball.current.position.set(s.x, BALL, s.z);
      ball.current.rotation.x += (s.vz * dt) / BALL;
      ball.current.rotation.z -= (s.vx * dt) / BALL;
    }
    if (goal.current) goal.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 3) * 0.04);
    starRefs.current.forEach((g, k) => { if (g) { g.visible = !s.stars[k]; g.rotation.y += dt * 2.5; g.position.y = 0.45 + Math.sin(state.clock.elapsedTime * 3 + k) * 0.08; } });
    state.camera.lookAt(0, 0, 0.6);
  });
  const table = useTex(tableWood, 10, 10), tray = useTex(trayWood, 2, 2), wall = useTex(wallWood, 1, 1);
  return (
    <>
      <color attach="background" args={["#1a1410"]} />
      <hemisphereLight args={["#fff3e0", "#2a1d12", 0.6]} />
      <directionalLight position={[3, 9, 4]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <spotLight position={[-4, 7, -3]} angle={0.6} penumbra={0.8} intensity={30} color="#ffd9a8" />
      <Environment resolution={128}>
        <Lightformer intensity={2.5} position={[0, 5, 3]} scale={[8, 3, 1]} />
        <Lightformer intensity={1.2} position={[-5, 2, -2]} rotation-y={Math.PI / 2} scale={[6, 2, 1]} color="#ffd9a8" />
        <Lightformer intensity={0.8} position={[5, 2, 0]} rotation-y={-Math.PI / 2} scale={[6, 2, 1]} color="#a8d8ff" />
      </Environment>
      {/* table */}
      <mesh position={[0, -1.6, 0]} rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[40, 40]} /><meshStandardMaterial map={table} roughness={0.55} /></mesh>
      <ContactShadows position={[0, -1.55, 0]} opacity={0.55} scale={n + 6} blur={2.5} far={3} />
      <group ref={board}>
        {/* walnut tray with a raised frame */}
        <RoundedBox args={[n + 0.7, 0.24, n + 0.7]} radius={0.08} position={[0, -0.13, 0]} receiveShadow castShadow>
          <meshStandardMaterial map={tray} roughness={0.4} metalness={0.05} />
        </RoundedBox>
        <mesh position={[0, -0.005, 0]} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[n, n]} /><meshStandardMaterial color="#e9dcc3" roughness={0.75} />
        </mesh>
        {Array.from({ length: n + 1 }, (_, i) => (
          <mesh key={i} position={[i - n / 2, 0, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[0.012, n]} /><meshBasicMaterial color="#cdbd9f" /></mesh>
        ))}
        {maze.walls.map(([cx, cz, w, d], k) => (
          <RoundedBox key={k} args={[w, 0.42, d]} radius={0.03} smoothness={2} position={[cx, 0.2, cz]} castShadow receiveShadow>
            <meshStandardMaterial map={k < 4 ? tray : wall} roughness={0.4} metalness={0.05} />
          </RoundedBox>
        ))}
        {/* goal: a real hole with a brass rim */}
        <group ref={goal} position={[maze.goal[0], 0.004, maze.goal[1]]}>
          <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[0.3, 40]} /><meshStandardMaterial color="#0b0806" roughness={1} /></mesh>
          <mesh rotation-x={-Math.PI / 2}><ringGeometry args={[0.3, 0.36, 40]} /><meshStandardMaterial color="#d4a94f" metalness={1} roughness={0.25} /></mesh>
          <group position={[0, 0.15, 0]}><Glow color="#c6f24e" size={1.2} opacity={0.45} /></group>
        </group>
        {maze.stars.map(([sx, sz], k) => (
          <group key={k} ref={(g) => { starRefs.current[k] = g; }} position={[sx, 0.45, sz]}>
            <mesh><octahedronGeometry args={[0.18, 0]} /><meshStandardMaterial color="#ffd23f" emissive="#c79a00" emissiveIntensity={1} /></mesh>
            <Glow color="#ffd23f" size={1} opacity={0.6} />
          </group>
        ))}
        <mesh ref={ball} castShadow>
          <sphereGeometry args={[BALL, 48, 48]} />
          <meshStandardMaterial color="#eef1f5" metalness={0.8} roughness={0.14} envMapIntensity={1.8} />
        </mesh>
        {sparks}
      </group>
    </>
  );
}

export function TiltMaze() {
  const [maze, setMaze] = useState(() => makeMaze(5));
  const [round, setRound] = useState(0);
  const st = useRef<State>(freshState(1, 0, maze));
  const [phase, setPhase] = useState<Phase>("idle");
  const [hud, setHud] = useState({ score: 0, time: 38, level: 1 });
  const [best, setBest] = usePersistent("best3dMaze", 0);
  const start = () => { const m = makeMaze(5); st.current = freshState(1, 0, m); setMaze(m); setRound((r) => r + 1); setHud({ score: 0, time: 38, level: 1 }); setPhase("play"); };
  return (
    <GameFrame title="Tilt Maze" emoji="🌀" phase={phase} score={hud.score} best={best} onStart={start}
      extra={<>
        <span className="rounded-xl border-2 border-white/30 bg-black/40 px-2.5 py-1 text-sm font-extrabold tabular-nums backdrop-blur">⏱ {Math.ceil(hud.time)}s</span>
        <span className="rounded-xl border-2 border-white/30 bg-[#8f7bff] px-2.5 py-1 text-sm font-extrabold">Level {hud.level}</span>
      </>}
      how={<>Tilt the board with your mouse to roll the ball to the green goal. Grab the gold stars for bonus points. Each level is a bigger maze; beat the clock.</>}>
      <div className="absolute inset-0 cursor-move touch-none">
        <Canvas shadows camera={{ position: [0, 10.5, 6.5], fov: 50 }} dpr={[1, 1.75]}>
          <Board key={round} st={st} maze={maze} phase={phase} onHud={(s) => setHud({ score: s.score, time: s.time, level: s.level })}
            onLevel={() => {
              const lv = st.current.level + 1;
              setTimeout(() => {
                const m = makeMaze(4 + lv);
                st.current = freshState(lv, st.current.score, m);
                setMaze(m); setRound((r) => r + 1);
              }, 700);
            }}
            onDie={() => { if (phase !== "play") return; setPhase("over"); setBest((b) => Math.max(b, st.current.score)); }} />
        </Canvas>
      </div>
    </GameFrame>
  );
}
