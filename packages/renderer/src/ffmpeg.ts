/**
 * ffmpeg/ffprobe helpers: probing, loudness measurement, two-pass EBU R128
 * mastering with a true-peak ceiling, platform transcodes and thumbnails.
 */
import { platformSpec, type Platform } from "@vid-skills/core";
import { exec, execOk } from "./exec.js";

export const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

export interface Probe {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  sizeBytes?: number;
  bitRate?: number;
  sampleRate?: number;
}

export async function probe(file: string): Promise<Probe> {
  const r = await execOk(FFPROBE, ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const j = JSON.parse(r.stdout) as { format?: { duration?: string; size?: string; bit_rate?: string }; streams?: Record<string, string | number>[] };
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  const fr = typeof v?.r_frame_rate === "string" ? v.r_frame_rate.split("/").map(Number) : undefined;
  return {
    durationSec: Number(j.format?.duration ?? 0),
    width: v ? Number(v.width) : undefined,
    height: v ? Number(v.height) : undefined,
    fps: fr && fr[1] ? fr[0]! / fr[1] : undefined,
    vcodec: v?.codec_name as string | undefined,
    acodec: a?.codec_name as string | undefined,
    sizeBytes: Number(j.format?.size ?? 0),
    bitRate: Number(j.format?.bit_rate ?? 0),
    sampleRate: a ? Number(a.sample_rate) : undefined,
  };
}

export interface Loudness {
  integrated: number;
  truePeak: number;
  lra: number;
  threshold: number;
}

/** Integrated loudness / true peak via loudnorm's analysis pass. */
export async function measureLoudness(file: string): Promise<Loudness | null> {
  const r = await exec(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(r.stderr);
  if (!m) return null;
  const j = JSON.parse(m[0]) as Record<string, string>;
  const n = (k: string) => Number(j[k]);
  if (!Number.isFinite(n("input_i"))) return null;
  return { integrated: n("input_i"), truePeak: n("input_tp"), lra: n("input_lra"), threshold: n("input_thresh") };
}

/**
 * Two-pass loudnorm to the target, then a true-peak safety limiter; video is
 * stream-copied. Silent inputs are passed through untouched.
 */
export async function masterAudio(input: string, output: string, target = { lufs: -14, truePeak: -1 }): Promise<Loudness | null> {
  const first = await exec(FFMPEG, ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(first.stderr);
  const j = m ? (JSON.parse(m[0]) as Record<string, string>) : null;
  if (!j || !Number.isFinite(Number(j.input_i)) || Number(j.input_i) < -70) {
    await execOk(FFMPEG, ["-y", "-hide_banner", "-i", input, "-c", "copy", output]);
    return null;
  }
  const filter =
    `loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=summary,` +
    `alimiter=limit=${Math.pow(10, (target.truePeak - 0.3) / 20).toFixed(4)}:attack=2:release=50:level=disabled,aresample=48000`;
  await execOk(FFMPEG, ["-y", "-hide_banner", "-i", input, "-map", "0:v?", "-map", "0:a?", "-c:v", "copy", "-af", filter, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output], { timeoutMs: 20 * 60_000 });
  return measureLoudness(output);
}

/** Re-encode for a platform's limits when the master doesn't fit (size/duration/fps). */
export async function transcodeFor(platform: Platform, input: string, output: string): Promise<string> {
  const spec = platformSpec(platform);
  const p = await probe(input);
  const needs = (p.sizeBytes ?? 0) > spec.maxBytes * 0.95 || p.durationSec > spec.maxSec || (p.fps ?? 30) > 60 || p.vcodec !== "h264";
  if (!needs) return input;
  const dur = Math.min(p.durationSec, spec.maxSec);
  const budgetKbps = Math.floor(((spec.maxBytes * 0.9 * 8) / dur / 1000) - spec.recommended.audioKbps);
  const vk = Math.max(800, Math.min(spec.recommended.videoKbps, budgetKbps));
  await execOk(
    FFMPEG,
    ["-y", "-hide_banner", "-i", input, "-t", String(dur), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-b:v", `${vk}k`, "-maxrate", `${Math.round(vk * 1.5)}k`, "-bufsize", `${vk * 2}k`, "-r", String(Math.min(60, Math.round(p.fps ?? 30))), "-c:a", "aac", "-b:a", `${spec.recommended.audioKbps}k`, "-ar", "48000", "-movflags", "+faststart", output],
    { timeoutMs: 30 * 60_000 },
  );
  return output;
}

export async function thumbnail(input: string, output: string, atSec = 0.5): Promise<string> {
  await execOk(FFMPEG, ["-y", "-hide_banner", "-ss", String(atSec), "-i", input, "-frames:v", "1", "-q:v", "2", output]);
  return output;
}
