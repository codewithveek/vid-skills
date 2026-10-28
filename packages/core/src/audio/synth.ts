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
