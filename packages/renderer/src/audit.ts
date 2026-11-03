/**
 * Automated deep audit of a reference video: the same measurements as
 * docs/audit/power-button-explainer.md, reproducible on any file.
 *
 * Measures: container/codec, frame timing, scene cuts and shot-length
 * distribution, enumeration montages, per-second luma/saturation/motion, layout
 * bands (persistent overlays vs content window), dominant palette, loudness
 * (integrated/LRA/true-peak/momentary), silences and music drops, voice pitch,
 * speaking rate and pauses (with STT), contact sheets and frame-by-frame strips.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guardHallucinations, round3, type STTProvider, type WordTiming } from "@vid-skills/core";
import { exec, execOk } from "./exec.js";
import { FFMPEG, probe, type Probe } from "./ffmpeg.js";

export interface AuditOptions {
  outDir: string;
  stt?: STTProvider;
  sceneThreshold?: number;
  images?: boolean;
}

export interface AuditReport {
  file: string;
  probe: Probe;
  frames: { count: number; dtMs: { min: number; median: number; max: number } };
  cuts: number[];
  shots: { count: number; medianSec: number; meanSec: number; minSec: number; maxSec: number; histogram: Record<string, number> };
  montages: { start: number; end: number; items: number; perItemSec: number }[];
  visual: { meanLuma: number; meanSaturation: number; perSecond: { t: number; luma: number; sat: number; motion: number }[] };
  layout: { persistentBands: { fromPct: number; toPct: number }[]; windowBand?: { fromPct: number; toPct: number; aspect: number } };
  palette: { hex: string; share: number }[];
  audio: {
    integratedLufs?: number;
    lra?: number;
    truePeakDb?: number;
    silences: { start: number; end: number }[];
    drops: { start: number; end: number }[];
    momentary: { t: number; lufs: number }[];
    pitchHz?: { median: number; p10: number; p90: number };
  };
  voice?: { words: number; wpm: number; medianGapMs: number; longPauses: number; transcript: string; wordsDetail: WordTiming[] };
  images: string[];
}

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

async function rawFrames(file: string, w: number, h: number, fps: number, fmt: "gray" | "rgb24"): Promise<Uint8Array[]> {
  const r = await new Promise<Buffer>((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const p = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=${w}:${h}`, "-pix_fmt", fmt, "-f", "rawvideo", "-"]);
      const chunks: Buffer[] = [];
      p.stdout.on("data", (d: Buffer) => chunks.push(d));
      p.on("error", reject);
      p.on("close", () => resolve(Buffer.concat(chunks)));
    }, reject);
  });
  const size = w * h * (fmt === "gray" ? 1 : 3);
  const out: Uint8Array[] = [];
  for (let o = 0; o + size <= r.length; o += size) out.push(new Uint8Array(r.buffer, r.byteOffset + o, size));
  return out;
}

function layoutBands(frames: Uint8Array[], w: number, h: number) {
  // Temporal std per row (low = persistent) and spatial detail per row (high = text/edges).
  const rows = h;
  const mean = new Float64Array(w * h);
  for (const f of frames) for (let i = 0; i < f.length; i++) mean[i]! += f[i]! / frames.length;
  const tstdRow = new Float64Array(rows);
  const detailRow = new Float64Array(rows);
  const edgeRow = new Float64Array(rows);
  for (let y = 0; y < rows; y++) {
    let ts = 0;
    let det = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = 0;
      for (const f of frames) v += (f[i]! - mean[i]!) ** 2;
      ts += Math.sqrt(v / frames.length);
      if (x > 0) det += Math.abs(mean[i]! - mean[i - 1]!);
    }
    tstdRow[y] = ts / w;
    detailRow[y] = det / w;
  }
  for (const f of frames) for (let y = 1; y < rows; y++) {
    let e = 0;
    for (let x = 0; x < w; x++) e += Math.abs(f[y * w + x]! - f[(y - 1) * w + x]!);
    edgeRow[y]! += e / w / frames.length;
  }
  const persistent: { fromPct: number; toPct: number }[] = [];
  const thrT = pct([...tstdRow], 25);
  const thrD = pct([...detailRow], 80);
  let start = -1;
  for (let y = 0; y <= rows; y++) {
    const on = y < rows && tstdRow[y]! <= thrT * 1.1 && detailRow[y]! >= thrD;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      if (y - start >= 2) persistent.push({ fromPct: round3((start / rows) * 100), toPct: round3((y / rows) * 100) });
      start = -1;
    }
  }
  // Window band: the two strongest horizontal edges that persist across frames.
  const idx = [...edgeRow.keys()].sort((a, b) => edgeRow[b]! - edgeRow[a]!);
  // Skip edges that belong to persistent overlays (e.g. the headline band) so the window's own top edge wins.
  const inBand = (y: number) => persistent.some((b) => (y / rows) * 100 >= b.fromPct - 2.5 && (y / rows) * 100 <= b.toPct + 2.5);
  const top = idx.find((y) => y > rows * 0.08 && y < rows * 0.5 && !inBand(y));
  const bot = idx.find((y) => top !== undefined && y > top + rows * 0.15 && y < rows * 0.95);
  const windowBand = top !== undefined && bot !== undefined ? { fromPct: round3((top / rows) * 100), toPct: round3((bot / rows) * 100), aspect: round3(w / (bot - top)) } : undefined;
  return { persistentBands: persistent.slice(0, 6), windowBand };
}

function palette(frames: Uint8Array[]): { hex: string; share: number }[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 3) {
      const r = f[i]!;
      const g = f[i + 1]!;
      const b = f[i + 2]!;
      const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
      bins.set(k, e);
      total++;
    }
  }
  const hex = (e: { n: number; r: number; g: number; b: number }) => `#${[e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  const sat = (e: { n: number; r: number; g: number; b: number }) => {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const all = [...bins.values()].sort((a, b) => b.n - a.n);
  const dominant = all.slice(0, 6);
  const accents = all.filter((e) => sat(e) > 90 && e.n / total > 0.0005).slice(0, 8);
  return [...dominant, ...accents].map((e) => ({ hex: hex(e), share: round3(e.n / total) }));
}

function pitch(pcm: Int16Array, sr: number, spans: { start: number; end: number }[]): { median: number; p10: number; p90: number } | undefined {
  const f0: number[] = [];
  const win = Math.floor(sr * 0.04);
  const minLag = Math.floor(sr / 400);
  const maxLag = Math.floor(sr / 60);
  for (const s of spans.slice(0, 400)) {
    for (let t = s.start; t + 0.04 < s.end; t += 0.08) {
      const o = Math.floor(t * sr);
      if (o + win + maxLag >= pcm.length) break;
      let energy = 0;
      for (let i = 0; i < win; i++) energy += pcm[o + i]! * pcm[o + i]!;
      if (energy / win < 2e5) continue;
      let best = 0;
      let bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let c = 0;
        for (let i = 0; i < win; i++) c += pcm[o + i]! * pcm[o + i + lag]!;
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      if (bestLag && best / energy > 0.45) f0.push(sr / bestLag);
    }
  }
  return f0.length > 20 ? { median: round3(median(f0)), p10: round3(pct(f0, 10)), p90: round3(pct(f0, 90)) } : undefined;
}

export async function auditVideo(file: string, o: AuditOptions): Promise<AuditReport> {
  await mkdir(o.outDir, { recursive: true });
  const pr = await probe(file);
  const dur = pr.durationSec;

  // 1. Per-frame timing, cuts, luma/sat/motion
  const metaFile = join(o.outDir, "frames.meta.txt");
  await execOk(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", `scdet=threshold=${o.sceneThreshold ?? 8},signalstats,metadata=print:file=${metaFile}`, "-f", "null", "-"], { timeoutMs: 30 * 60_000 });
  const meta = await readFile(metaFile, "utf8");
  const rows: { t: number; sc: number; y: number; s: number }[] = [];
  for (const b of meta.split("frame:").slice(1)) {
    const g = (re: RegExp) => Number(re.exec(b)?.[1] ?? 0);
    rows.push({ t: g(/pts_time:([\d.]+)/), sc: g(/lavfi\.scd\.score=([\d.]+)/), y: g(/YAVG=([\d.]+)/), s: g(/SATAVG=([\d.]+)/) });
  }
  const dts = rows.slice(1).map((r, i) => (r.t - rows[i]!.t) * 1000);
  const cuts = rows.filter((r) => r.sc >= (o.sceneThreshold ?? 8)).map((r) => round3(r.t));
  const bounds = [0, ...cuts, dur];
  const shotLens = bounds.slice(1).map((b, i) => b - bounds[i]!).filter((x) => x > 0);
  const hist: Record<string, number> = { "<0.3s": 0, "0.3-1s": 0, "1-2s": 0, "2-4s": 0, "4-8s": 0, ">8s": 0 };
  for (const l of shotLens) hist[l < 0.3 ? "<0.3s" : l < 1 ? "0.3-1s" : l < 2 ? "1-2s" : l < 4 ? "2-4s" : l < 8 ? "4-8s" : ">8s"]!++;
  const montages: AuditReport["montages"] = [];
  for (let i = 0; i < cuts.length; ) {
    let j = i;
    while (j + 1 < cuts.length && cuts[j + 1]! - cuts[j]! < 0.4) j++;
    if (j - i + 1 >= 3) montages.push({ start: cuts[i]!, end: cuts[j]!, items: j - i + 1, perItemSec: round3((cuts[j]! - cuts[i]!) / (j - i)) });
    i = j + 1;
  }
  const perSec = new Map<number, { y: number[]; s: number[]; m: number[] }>();
  for (const r of rows) {
    const k = Math.floor(r.t);
    const e = perSec.get(k) ?? { y: [], s: [], m: [] };
    e.y.push(r.y);
    e.s.push(r.s);
    e.m.push(r.sc);
    perSec.set(k, e);
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const perSecond = [...perSec.entries()].map(([t, e]) => ({ t, luma: round3(avg(e.y)), sat: round3(avg(e.s)), motion: round3(avg(e.m)) }));

  // 2. Layout + palette from sampled frames
  const sampleFps = Math.max(0.2, Math.min(1, 40 / Math.max(1, dur)));
  const gw = 90;
  const gh = Math.round((gw * (pr.height ?? 1920)) / (pr.width ?? 1080));
  const gray = await rawFrames(file, gw, gh, sampleFps, "gray");
  const layout = gray.length >= 3 ? layoutBands(gray, gw, gh) : { persistentBands: [] };
  const rgb = await rawFrames(file, 48, Math.round((48 * gh) / gw), sampleFps, "rgb24");
  const pal = palette(rgb);

  // 3. Audio
  const audio: AuditReport["audio"] = { silences: [], drops: [], momentary: [] };
  const eb = await exec(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs: 20 * 60_000, maxBuffer: 64 * 2 ** 20 });
  const sum = eb.stderr.slice(eb.stderr.lastIndexOf("Summary:"));
  audio.integratedLufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]);
  audio.lra = Number(/LRA:\s+([\d.]+) LU/.exec(sum)?.[1]);
  audio.truePeakDb = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]);
  const momFile = join(o.outDir, "momentary.txt");
  await exec(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=${momFile}`, "-f", "null", "-"], { timeoutMs: 20 * 60_000 });
  const momTxt = await readFile(momFile, "utf8").catch(() => "");
  const mom = new Map<number, number[]>();
  const times = [...momTxt.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const vals = [...momTxt.matchAll(/lavfi\.r128\.M=(-?[\d.]+|-?inf)/g)].map((m) => (m[1]!.includes("inf") ? -120 : Number(m[1])));
  times.forEach((t, i) => {
    const k = Math.floor(t * 2) / 2;
    (mom.get(k) ?? mom.set(k, []).get(k)!).push(vals[i] ?? -120);
  });
  audio.momentary = [...mom.entries()].map(([t, v]) => ({ t, lufs: round3(avg(v)) }));
  const sd = await exec(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=n=-40dB:d=0.25", "-f", "null", "-"], { timeoutMs: 20 * 60_000 });
  const starts = [...sd.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...sd.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  audio.silences = starts.map((s, i) => ({ start: round3(s), end: round3(ends[i] ?? dur) }));
  audio.drops = audio.silences.filter((s) => s.start > 3 && s.end < dur - 3 && s.end - s.start < 2);

  // 4. Voice: pitch + STT
  const wav = join(o.outDir, "audio16k.wav");
  await execOk(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  const wavBytes = new Uint8Array(await readFile(wav));
  const pcm = new Int16Array(wavBytes.buffer, wavBytes.byteOffset + 44, Math.floor((wavBytes.length - 44) / 2));
  let voice: AuditReport["voice"];
  let speechSpans = [{ start: 0, end: dur }];
  if (o.stt) {
    try {
      const tr = await o.stt.transcribe({ bytes: wavBytes, mime: "audio/wav" });
      const ws = guardHallucinations(tr.words, audio.silences);
      if (ws.length) {
        const gaps = ws.slice(1).map((w, i) => (w.start - ws[i]!.end) * 1000);
        voice = { words: ws.length, wpm: round3(ws.length / ((ws[ws.length - 1]!.end - ws[0]!.start) / 60)), medianGapMs: round3(median(gaps)), longPauses: gaps.filter((g) => g > 350).length, transcript: ws.map((w) => w.text).join(" "), wordsDetail: ws };
        speechSpans = ws.map((w) => ({ start: w.start, end: w.end }));
      }
    } catch (e) {
      voice = undefined;
      await writeFile(join(o.outDir, "stt-error.txt"), String(e));
    }
  }
  audio.pitchHz = pitch(pcm, 16000, speechSpans.length > 1 ? speechSpans : [{ start: 0, end: Math.min(dur, 60) }]);

  // 5. Images
  const images: string[] = [];
  if (o.images !== false) {
    const sheet = join(o.outDir, "contact_%02d.jpg");
    await exec(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", "fps=1,scale=192:-1,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=14:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=8x4", sheet]);
    images.push("contact_*.jpg");
    for (const [k, m] of montages.slice(0, 3).entries()) {
      const out = join(o.outDir, `montage_${k}.jpg`);
      await exec(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, m.start - 0.2)), "-t", String(m.end - m.start + 0.6), "-i", file, "-vf", "fps=30,scale=160:-1,tile=10x4", "-frames:v", "1", out]);
      images.push(`montage_${k}.jpg`);
    }
  }

  const report: AuditReport = {
    file,
    probe: pr,
    frames: { count: rows.length, dtMs: { min: round3(Math.min(...dts)), median: round3(median(dts)), max: round3(Math.max(...dts)) } },
    cuts,
    shots: { count: shotLens.length, medianSec: round3(median(shotLens)), meanSec: round3(avg(shotLens)), minSec: round3(Math.min(...shotLens)), maxSec: round3(Math.max(...shotLens)), histogram: hist },
    montages,
    visual: { meanLuma: round3(avg(rows.map((r) => r.y))), meanSaturation: round3(avg(rows.map((r) => r.s))), perSecond },
    layout,
    palette: pal,
    audio,
    voice,
    images,
  };
  await writeFile(join(o.outDir, "audit.json"), JSON.stringify(report, null, 1));
  await writeFile(join(o.outDir, "audit.md"), auditMarkdown(report));
  return report;
}

export function auditMarkdown(r: AuditReport): string {
  const p = r.probe;
  return `# Audit: ${r.file.split("/").pop()}

| | |
| --- | --- |
| Duration | ${p.durationSec.toFixed(2)} s |
| Video | ${p.vcodec} ${p.width}×${p.height} @ ${p.fps?.toFixed(2)} fps, ${(p.bitRate ?? 0) / 1000} kb/s total |
| Audio | ${p.acodec} ${p.sampleRate} Hz |
| Frames | ${r.frames.count} (Δt ${r.frames.dtMs.min}–${r.frames.dtMs.max} ms, median ${r.frames.dtMs.median}) |
| Cuts | ${r.cuts.length} · shots median ${r.shots.medianSec} s, mean ${r.shots.meanSec} s, max ${r.shots.maxSec} s |
| Shot histogram | ${Object.entries(r.shots.histogram).map(([k, v]) => `${k}: ${v}`).join(" · ")} |
| Montages | ${r.montages.map((m) => `${m.start}s ×${m.items} @ ${m.perItemSec}s`).join(", ") || "none"} |
| Mean luma / saturation | ${r.visual.meanLuma} / ${r.visual.meanSaturation} |
| Persistent overlay bands | ${r.layout.persistentBands.map((b) => `${b.fromPct}–${b.toPct}%`).join(", ") || "none"} |
| Content window | ${r.layout.windowBand ? `${r.layout.windowBand.fromPct}–${r.layout.windowBand.toPct}% (aspect ${r.layout.windowBand.aspect}:1)` : "full frame"} |
| Palette | ${r.palette.map((c) => `\`${c.hex}\``).join(" ")} |
| Loudness | ${r.audio.integratedLufs} LUFS · LRA ${r.audio.lra} LU · true peak ${r.audio.truePeakDb} dBFS |
| Silences / drops | ${r.audio.silences.length} / ${r.audio.drops.map((d) => `${d.start}s`).join(", ") || "none"} |
| Voice pitch | ${r.audio.pitchHz ? `median ${r.audio.pitchHz.median} Hz (p10 ${r.audio.pitchHz.p10}, p90 ${r.audio.pitchHz.p90})` : "n/a"} |
| Speech | ${r.voice ? `${r.voice.words} words · ${r.voice.wpm} wpm · median gap ${r.voice.medianGapMs} ms · ${r.voice.longPauses} pauses > 350 ms` : "not transcribed"} |
`;
}
