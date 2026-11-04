// Synthesised soundtrack for the night-watch easter egg (Web Audio, no files): rain and a low city drone,
// a burst of bat wings, thunder, footsteps on wet stone, the whoosh of a thrown dart, a metallic impact
// and a cinematic brass-and-timpani hit when the poster is revealed.
import { isMuted } from "@/lib/sfx";

export type KnightCue = "bats" | "thunder" | "step" | "throw" | "hit" | "vanish";
export interface KnightSound { cue(c: KnightCue): void; stop(): void }

const SILENT: KnightSound = { cue() {}, stop() {} };

export function startKnightSound(): KnightSound {
  if (typeof window === "undefined" || isMuted()) return SILENT;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return SILENT;
  const ctx = new C();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // a little room: a short feedback delay gives the alley its echo
  const echo = ctx.createDelay(1); echo.delayTime.value = 0.23;
  const fb = ctx.createGain(); fb.gain.value = 0.28;
  const wet = ctx.createGain(); wet.gain.value = 0.35;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
  echo.connect(lp).connect(fb).connect(echo); lp.connect(wet).connect(ctx.destination);
  master.connect(ctx.destination); master.connect(echo);

  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const now = () => ctx.currentTime;
  const env = (g: GainNode, at: number, peak: number, attack: number, dur: number) => {
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  };
  const noise = (at: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = "lowpass", attack = 0.005) => {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); env(g, at, vol, attack, dur);
    s.connect(f).connect(g).connect(master); s.start(at, Math.random()); s.stop(at + dur + 0.05);
    return f;
  };
  const tone = (at: number, type: OscillatorType, f0: number, f1: number, vol: number, attack: number, dur: number, cutoff = 4000) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff;
    const g = ctx.createGain(); env(g, at, vol, attack, dur);
    o.connect(f).connect(g).connect(master); o.start(at); o.stop(at + dur + 0.05);
  };

  // rain: a steady hiss with a little patter on top
  const rain = ctx.createBufferSource(); rain.buffer = noiseBuf; rain.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = "highpass"; rf.frequency.value = 1800;
  const rg = ctx.createGain(); rg.gain.setValueAtTime(0.0001, now()); rg.gain.exponentialRampToValueAtTime(0.06, now() + 1.5);
  rain.connect(rf).connect(rg).connect(master); rain.start();

  // a low, uneasy drone: two detuned saws through a slowly opening filter
  const drone = ctx.createGain(); drone.gain.setValueAtTime(0.0001, now()); drone.gain.exponentialRampToValueAtTime(0.07, now() + 2.5);
  const df = ctx.createBiquadFilter(); df.type = "lowpass"; df.frequency.setValueAtTime(140, now()); df.frequency.linearRampToValueAtTime(420, now() + 5);
  const oscs = [55, 55.4, 82.4].map((f) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(df); o.start(); return o; });
  df.connect(drone).connect(master);

  // a slow heartbeat pulse under the build-up
  for (let k = 0; k < 6; k++) { const at = now() + 2.2 + k * 0.62; tone(at, "sine", 62, 40, 0.22, 0.01, 0.22, 300); tone(at + 0.17, "sine", 58, 38, 0.14, 0.01, 0.2, 300); }

  const cues: Record<KnightCue, () => void> = {
    bats() {
      const t = now();
      for (let k = 0; k < 46; k++) {   // dozens of wing flutters, dense at first then thinning
        const at = t + Math.pow(Math.random(), 1.7) * 1.8;
        noise(at, 0.05 + Math.random() * 0.05, 2200 + Math.random() * 2600, 2.5, 0.05 + Math.random() * 0.05, "bandpass", 0.004);
      }
      for (let k = 0; k < 7; k++) {    // high squeaks
        const at = t + Math.random() * 1.4, f = 5200 + Math.random() * 2500;
        tone(at, "triangle", f, f * 0.8, 0.018, 0.005, 0.07, 9000);
      }
      noise(t, 1.6, 600, 0.6, 0.08, "bandpass", 0.2);   // rush of air
    },
    thunder() {
      const t = now();
      noise(t, 0.25, 3000, 0.4, 0.35, "lowpass", 0.002);            // crack
      noise(t + 0.08, 3.2, 180, 0.8, 0.45, "lowpass", 0.05);         // rumble
      noise(t + 0.6, 2.4, 90, 1, 0.35, "lowpass", 0.3);
    },
    step() {
      const t = now();
      noise(t, 0.09, 900, 1.2, 0.12, "bandpass", 0.003);            // heel on wet stone
      noise(t + 0.02, 0.12, 3500, 1, 0.03, "highpass", 0.003);      // splash
      tone(t, "sine", 110, 60, 0.12, 0.003, 0.09, 400);
    },
    throw() {
      const t = now();
      noise(t, 0.5, 900, 1.8, 0.2, "bandpass", 0.03).frequency.exponentialRampToValueAtTime(3200, t + 0.45);   // rising whoosh
      for (let k = 0; k < 5; k++) noise(t + 0.08 + k * 0.08, 0.05, 2800, 4, 0.04, "bandpass", 0.004);           // spinning flutter
    },
    hit() {
      const t = now();
      noise(t, 0.08, 4000, 0.7, 0.5, "lowpass", 0.001);             // impact
      tone(t, "sine", 160, 55, 0.6, 0.002, 0.35, 900);              // thud into the wall
      [1840, 2710, 3960].forEach((f, i) => tone(t, "triangle", f, f * 0.99, 0.05 / (i + 1), 0.002, 0.9, 9000));   // metallic ring
      // the reveal: timpani and a low brass chord swelling into the echo
      tone(t + 0.05, "sine", 70, 46, 0.7, 0.005, 1.6, 500);
      [73.4, 110, 146.8, 174.6].forEach((f, i) => {
        tone(t + 0.08, "sawtooth", f, f, 0.07 - i * 0.008, 0.18, 3.2, 900 + i * 200);
        tone(t + 0.08, "sawtooth", f * 1.006, f * 1.006, 0.05, 0.22, 3.2, 900);
      });
      drone.gain.setTargetAtTime(0.035, t, 0.8);
    },
    vanish() {
      const t = now();
      noise(t, 1.2, 1200, 0.7, 0.12, "bandpass", 0.25);
      for (let k = 0; k < 22; k++) noise(t + Math.random() * 1.1, 0.06, 2500 + Math.random() * 2000, 2.5, 0.05, "bandpass", 0.004);
    },
  };

  let stopped = false;
  return {
    cue(c) { if (!stopped) cues[c](); },
    stop() {
      if (stopped) return;
      stopped = true;
      master.gain.setTargetAtTime(0.0001, now(), 0.25);
      wet.gain.setTargetAtTime(0.0001, now(), 0.25);
      window.setTimeout(() => { oscs.forEach((o) => o.stop()); rain.stop(); void ctx.close(); }, 1000);
    },
  };
}
