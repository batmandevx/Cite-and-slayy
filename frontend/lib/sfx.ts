"use client";

/** Tiny synthesized sound effects (Web Audio, no files). Muted state persists in localStorage. */
type Sfx = "coin" | "hit" | "pop" | "whoosh" | "start" | "over" | "right" | "wrong" | "tick" | "chime" | "flip" | "combo";

let ctx: AudioContext | null = null;
const KEY = "slayy:muted";

export const isMuted = () => typeof window !== "undefined" && localStorage.getItem(KEY) === "1";
export function setMuted(m: boolean) {
  localStorage.setItem(KEY, m ? "1" : "0");
  window.dispatchEvent(new CustomEvent("slayy:muted", { detail: m }));
}

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.08, slideTo?: number, delay = 0) {
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.12) {
  const a = ac();
  if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = 900;
  s.buffer = buf; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}

/** Play a sound; `pitch` (0..1+) raises coins/combos for streaks. */
export function sfx(kind: Sfx, pitch = 0) {
  if (isMuted()) return;
  const p = 1 + pitch * 0.5;
  switch (kind) {
    case "coin": tone(988 * p, 0.08, "square", 0.06); tone(1319 * p, 0.18, "square", 0.06, undefined, 0.07); break;
    case "combo": [0, 1, 2].forEach((i) => tone(660 * p * (1 + i * 0.26), 0.1, "triangle", 0.07, undefined, i * 0.06)); break;
    case "pop": tone(520 + Math.random() * 300, 0.09, "sine", 0.14, 1400); break;
    case "hit": noise(0.28, 0.18); tone(140, 0.3, "sawtooth", 0.08, 50); break;
    case "whoosh": tone(300, 0.25, "sine", 0.05, 900); break;
    case "start": [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.05, undefined, i * 0.08)); break;
    case "over": [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, "triangle", 0.08, undefined, i * 0.14)); break;
    case "right": tone(784, 0.1, "triangle", 0.08); tone(1175, 0.2, "triangle", 0.08, undefined, 0.09); break;
    case "wrong": tone(220, 0.25, "sawtooth", 0.06, 150); break;
    case "tick": tone(1800, 0.03, "square", 0.025); break;
    case "chime": [880, 1109, 1319].forEach((f, i) => tone(f, 0.6, "sine", 0.07, undefined, i * 0.12)); break;
    case "flip": tone(700, 0.05, "triangle", 0.05, 1000); break;
  }
}
