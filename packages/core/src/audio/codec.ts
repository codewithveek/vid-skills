/**
 * Minimal, dependency-free audio container helpers that run anywhere (Workers
 * included): WAV read/write, raw PCM wrapping, and duration probing for WAV,
 * MP3 (frame scan, VBR-safe), and Ogg/Opus/FLAC best-effort.
 */

export interface PcmInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export function parseWav(bytes: Uint8Array): PcmInfo | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    let size = dv.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmt = { channels: dv.getUint16(off + 10, true), sampleRate: dv.getUint32(off + 12, true), bitsPerSample: dv.getUint16(off + 22, true) };
    } else if (id === "data" && fmt) {
      // Streaming encoders sometimes write 0 or 0xFFFFFFFF: clamp to the actual bytes.
      if (size === 0 || size === 0xffffffff || off + 8 + size > bytes.length) size = bytes.length - off - 8;
      return { ...fmt, dataOffset: off + 8, dataLength: size };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

export function wavDuration(bytes: Uint8Array): number | null {
  const i = parseWav(bytes);
  if (!i) return null;
  return i.dataLength / (i.sampleRate * i.channels * (i.bitsPerSample / 8));
}

/** Wrap 16-bit little-endian PCM in a WAV header. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  w(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length, true);
  w(8, "WAVE");
  w(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  w(36, "data");
  dv.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export function floatToWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  const dv = new DataView(pcm.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return pcm16ToWav(pcm, sampleRate, 1);
}

const MP3_BITRATES: Record<string, number[]> = {
  // [version][layer] tables (kbps), index 1..14
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Sum MP3 frame durations (handles VBR and ID3v2 tags). */
export function mp3Duration(bytes: Uint8Array): number | null {
  let off = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f);
    off = 10 + size;
  }
  let dur = 0;
  let frames = 0;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff || (bytes[off + 1]! & 0xe0) !== 0xe0) {
      off++;
      continue;
    }
    const b1 = bytes[off + 1]!;
    const b2 = bytes[off + 2]!;
    const ver = (b1 >> 3) & 3; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layer = (b1 >> 1) & 3; // 1 = Layer III
    if (ver === 1 || layer !== 1) {
      off++;
      continue;
    }
    const brIdx = (b2 >> 4) & 15;
    const srIdx = (b2 >> 2) & 3;
    const pad = (b2 >> 1) & 1;
    const table = MP3_BITRATES[ver === 3 ? "1-3" : "2-3"]!;
    const br = (table[brIdx] ?? 0) * 1000;
    const sr = MP3_RATES[ver]?.[srIdx];
    if (!br || !sr) {
      off++;
      continue;
    }
    const samples = ver === 3 ? 1152 : 576;
    const len = Math.floor(((ver === 3 ? 144 : 72) * br) / sr) + pad;
    if (len < 4) break;
    dur += samples / sr;
    frames++;
    off += len;
  }
  return frames ? dur : null;
}

export function audioDuration(bytes: Uint8Array, mime: string): number | null {
  const m = mime.toLowerCase();
  if (m.includes("wav") || m.includes("wave")) return wavDuration(bytes);
  if (m.includes("mpeg") || m.includes("mp3")) return mp3Duration(bytes);
  if (m.startsWith("audio/pcm") || m.includes("l16")) {
    const rate = Number(/rate=(\d+)/.exec(m)?.[1] ?? 24000);
    return bytes.length / 2 / rate;
  }
  // Fallbacks: try both parsers by magic.
  return wavDuration(bytes) ?? mp3Duration(bytes);
}
