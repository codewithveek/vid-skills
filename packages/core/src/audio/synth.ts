/**
 * Procedural foley fallback: deterministic SFX synthesized in pure TypeScript
 * (filtered noise and short transients, no tonal chimes). Used only when no SFX
 * provider or library is configured, so a hands-free run never ships silent actions.
 */
import { seededRandom, hashString } from "../util.js";
import { floatToWav } from "./codec.js";

const SR = 48000;

function onePoleLP(x: Float32Array, cutoff: (i: number) => number): Float32Array {
  const y = new Float32Array(x.length);
  let prev = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.exp((-2 * Math.PI * cutoff(i)) / SR);
    prev = (1 - a) * x[i]! + a * prev;
    y[i] = prev;
  }
  return y;
}

function noise(n: number, seed: number): Float32Array {
  const r = seededRandom(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}

function normalize(x: Float32Array, peak = 0.7): Float32Array {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i]! / m) * peak;
  return x;
}

export type SynthCue = "whoosh" | "swipe" | "click" | "tick" | "pop" | "riser" | "impact";

export function synthSfx(cue: SynthCue | string, take = 0): { bytes: Uint8Array; mime: string; durationSec: number } {
  const seed = hashString(`${cue}:${take}`);
  let x: Float32Array;
  switch (cue) {
    case "whoosh":
    case "swipe": {
      const dur = cue === "swipe" ? 0.35 : 0.6;
      const n = Math.floor(dur * SR);
      const nz = noise(n, seed);
      x = onePoleLP(nz, (i) => 300 + 5200 * Math.sin((Math.PI * i) / n) ** 2);
      for (let i = 0; i < n; i++) x[i]! *= Math.sin((Math.PI * i) / n) ** 1.6;
      break;
    }
    case "click":
    case "tick": {
      const dur = cue === "tick" ? 0.03 : 0.06;
      const n = Math.floor(dur * SR);
      const nz = noise(n, seed);
      x = new Float32Array(n);
      let prev = 0;
      for (let i = 0; i < n; i++) {
        const hp = nz[i]! - prev; // crude high-pass for a crisp transient
        prev = nz[i]!;
        x[i] = hp * Math.exp((-i / SR) * (cue === "tick" ? 260 : 120));
      }
      break;
    }
    case "pop": {
      const dur = 0.12;
      const n = Math.floor(dur * SR);
      x = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const f = 900 * Math.exp((-i / SR) * 30) + 180; // fast downward sweep reads as a bubble pop
        ph += (2 * Math.PI * f) / SR;
        x[i] = Math.sin(ph) * Math.exp((-i / SR) * 38);
      }
      break;
    }
    case "riser": {
      const dur = 1.6;
      const n = Math.floor(dur * SR);
      const nz = noise(n, seed);
      x = onePoleLP(nz, (i) => 200 + 7000 * (i / n) ** 2);
      for (let i = 0; i < n; i++) x[i]! *= (i / n) ** 2;
      break;
    }
    case "impact":
    default: {
      const dur = 0.7;
      const n = Math.floor(dur * SR);
      const nz = onePoleLP(noise(n, seed), () => 900);
      x = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const f = 70 * Math.exp((-i / SR) * 3) + 38;
        ph += (2 * Math.PI * f) / SR;
        x[i] = Math.sin(ph) * Math.exp((-i / SR) * 6) + nz[i]! * Math.exp((-i / SR) * 18) * 0.6;
      }
      break;
    }
  }
  normalize(x, 0.6);
  return { bytes: floatToWav(x, SR), mime: "audio/wav", durationSec: x.length / SR };
}

/**
 * A quiet, warm ambient pad to sit under narration: slow chords (Am9 → Fmaj7 → Cmaj7 → G6),
 * each voice a sine with soft 2nd/3rd harmonics and a slightly detuned twin, long swells,
 * a gentle low-pass and a slow breath. Deterministic (same seed → same bytes), mono 22.05 kHz.
 */
export function synthPad(durationSec: number, seed = 0): { bytes: Uint8Array; mime: string; durationSec: number } {
  const sr = 22050;
  const len = Math.max(1, Math.round(durationSec * sr));
  const out = new Float32Array(len);
  const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
  // A minor colour, voiced low and open (MIDI notes).
  const chords = [
    [45, 52, 55, 59, 60], // Am9 (A2 E3 G3 B3 C4)
    [41, 48, 52, 57, 60], // Fmaj7 (F2 C3 E3 A3 C4)
    [48, 52, 55, 59, 64], // Cmaj7 (C3 E3 G3 B3 E4)
    [43, 50, 55, 59, 64], // G6 (G2 D3 G3 B3 E4)
  ];
  const chordSec = 8;
  const fade = 3; // swell in/out, overlapping the next chord
  const start = seed % chords.length;
  const nChords = Math.ceil(durationSec / chordSec) + 1;
  for (let c = 0; c < nChords; c++) {
    const notes = chords[(start + c) % chords.length]!;
    const t0 = c * chordSec - fade / 2;
    const t1 = t0 + chordSec + fade;
    const i0 = Math.max(0, Math.floor(t0 * sr));
    const i1 = Math.min(len, Math.ceil(t1 * sr));
    notes.forEach((m, v) => {
      const f = hz(m);
      const det = 1.0018 + v * 0.0004;
      const gain = (m < 48 ? 0.16 : 0.11) / notes.length;
      for (let i = i0; i < i1; i++) {
        const t = i / sr;
        const u = t - t0;
        const env = Math.min(1, u / fade, (t1 - t) / fade);
        const sm = env * env * (3 - 2 * env); // smoothstep swell
        const ph = 2 * Math.PI * f * t;
        const s = Math.sin(ph) + 0.28 * Math.sin(2 * ph + v) + 0.1 * Math.sin(3 * ph + 2 * v) + 0.8 * Math.sin(ph * det + v * 1.3);
        out[i]! += s * gain * sm;
      }
    });
  }
  // Slow breath (0.07 Hz), one-pole low-pass (~1.6 kHz), 2 s fade in/out, normalise to −16 dBFS peak.
  const a = Math.exp((-2 * Math.PI * 1600) / sr);
  let y = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const breath = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t);
    const edge = Math.min(1, t / 2, (durationSec - t) / 2);
    y = (1 - a) * out[i]! * breath + a * y;
    out[i] = y * Math.max(0, edge);
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  const g = peak > 0 ? 0.158 / peak : 1;
  for (let i = 0; i < len; i++) out[i]! *= g;
  return { bytes: floatToWav(out, sr), mime: "audio/wav", durationSec: len / sr };
}
