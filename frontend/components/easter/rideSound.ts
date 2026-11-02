// Synthesised soundtrack for the horse-ride easter egg (Web Audio, no files): meadow wind, birdsong,
// a neigh, galloping hooves that fade as she rides away, and a whoosh + thud for the fence jump.
import { isMuted } from "@/lib/sfx";

export interface RideSound { jump(): void; setDistance(f: number): void; stop(): void }

const SILENT: RideSound = { jump() {}, setDistance() {}, stop() {} };

export function startRideSound(): RideSound {
  if (typeof window === "undefined" || isMuted()) return SILENT;
  const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return SILENT;
  const ctx = new C();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  // one shared second of white noise for hooves, wind and whooshes
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = (at: number, dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = "lowpass", out: AudioNode = master) => {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out); src.start(at, Math.random() * 0.5); src.stop(at + dur + 0.05);
  };
  const thump = (at: number, freq: number, vol: number, dur: number, out: AudioNode = master) => {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(freq, at); o.frequency.exponentialRampToValueAtTime(freq * 0.45, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.02);
  };

  // meadow wind: a slow, breathing band of filtered noise
  const wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 420; wf.Q.value = 0.6;
  const wg = ctx.createGain(); wg.gain.setValueAtTime(0.0001, ctx.currentTime); wg.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 1.2);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.18; const lg = ctx.createGain(); lg.gain.value = 160;
  lfo.connect(lg).connect(wf.frequency); lfo.start();
  wind.connect(wf).connect(wg).connect(master); wind.start();

  // birdsong: little chirps every so often
  const chirp = (at: number) => {
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const t = at + k * 0.09, o = ctx.createOscillator(), g = ctx.createGain(), f0 = 2600 + Math.random() * 1600;
      o.type = "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.35, t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.08);
    }
  };
  [0.4, 2.3, 3.9, 5.8].forEach((d) => chirp(ctx.currentTime + d + Math.random() * 0.3));

  // a neigh as they set off: a wavering, falling whinny with a breathy edge
  const neigh = (at: number) => {
    const o = ctx.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(620, at); o.frequency.linearRampToValueAtTime(880, at + 0.18); o.frequency.exponentialRampToValueAtTime(330, at + 1.05);
    const vib = ctx.createOscillator(); vib.frequency.value = 17; const vg = ctx.createGain(); vg.gain.value = 55;
    vib.connect(vg).connect(o.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1300; bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.09, at + 0.06); g.gain.setValueAtTime(0.09, at + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    o.connect(bp).connect(g).connect(master); o.start(at); vib.start(at); o.stop(at + 1.15); vib.stop(at + 1.15);
    noise(at + 1.0, 0.25, 900, 0.8, 0.05, "bandpass");     // the snort at the end
  };
  neigh(ctx.currentTime + 0.25);

  // galloping hooves: three beats and a pause per stride, louder close by, fading as she rides away
  const hoof = ctx.createGain(); hoof.gain.value = 1; hoof.connect(master);
  let nextStride = ctx.currentTime + 0.35, stopped = false, airborne = 0;
  const STRIDE = 0.43;
  const schedule = () => {
    while (!stopped && nextStride < ctx.currentTime + 0.25) {
      if (ctx.currentTime > airborne) {
        [0, 0.075, 0.15].forEach((d, i) => {
          const at = nextStride + d + (Math.random() - 0.5) * 0.008, v = i === 2 ? 0.55 : 0.4;
          noise(at, 0.07, 700 + Math.random() * 300, 1, v * 0.5, "lowpass", hoof);
          thump(at, 95 + Math.random() * 20, v, 0.09, hoof);
        });
      }
      nextStride += STRIDE;
    }
  };
  const timer = window.setInterval(schedule, 60);
  schedule();

  return {
    jump() {
      const t = ctx.currentTime;
      airborne = t + 0.55;
      noise(t + 0.05, 0.5, 900, 0.7, 0.12, "bandpass");     // whoosh over the rails
      thump(t + 0.62, 70, 0.9, 0.18, hoof);                 // landing
      noise(t + 0.62, 0.12, 500, 1, 0.3, "lowpass", hoof);
    },
    setDistance(f) { hoof.gain.setTargetAtTime(Math.max(0.03, 1 - f), ctx.currentTime, 0.2); },
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
      window.setTimeout(() => { void ctx.close(); }, 900);
    },
  };
}
