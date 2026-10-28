/**
 * Audio mixing/mastering outside the browser.
 *
 * HyperFrames already mixes the <audio> clips (volume lanes, fades, fx chains)
 * during render. This module adds broadcast-style mastering on top and offers
 * an alternative full ffmpeg mix (sidechain ducking) for pipelines that render
 * picture-only or want a mix that does not depend on the browser audio graph.
 */
import type { Timeline } from "@vid-skills/core";
import { execOk, exec } from "./exec.js";
import { FFMPEG } from "./ffmpeg.js";

export { masterAudio, measureLoudness } from "./ffmpeg.js";

/**
 * Mix stems with ffmpeg: voice segments placed with adelay, music looped and
 * side-chain compressed under the voice, SFX placed at their hit times, then
 * loudnorm to the target. Returns the output WAV path.
 */
export async function mixStems(tl: Timeline, files: Record<string, string>, out: string, target = { lufs: -14, truePeak: -1 }): Promise<string> {
  const inputs: string[] = [];
  const parts: string[] = [];
  const voice: string[] = [];
  const music: string[] = [];
  const sfx: string[] = [];
  let i = 0;
  for (const c of tl.audio) {
    const f = files[c.assetId];
    if (!f) continue;
    if (c.role === "music") inputs.push("-stream_loop", "-1");
    inputs.push("-i", f);
    const ms = Math.round(c.start * 1000);
    const lbl = `a${i}`;
    const trim = c.duration ? `atrim=0:${c.duration.toFixed(3)},` : "";
    const fades = `${c.fadeIn ? `afade=t=in:d=${c.fadeIn},` : ""}${c.fadeOut && c.duration ? `afade=t=out:st=${Math.max(0, c.duration - c.fadeOut).toFixed(3)}:d=${c.fadeOut},` : ""}`;
    const gain = c.role === "music" ? Math.max(0.05, c.automation[0]?.v ?? 0.3) * c.volume : c.volume;
    parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,${trim}${fades}volume=${gain.toFixed(3)},adelay=${ms}|${ms}[${lbl}]`);
    (c.role === "voice" ? voice : c.role === "music" ? music : sfx).push(`[${lbl}]`);
    i++;
  }
  if (!voice.length) throw new Error("mixStems: no voice stems");
  const dur = tl.durationSec.toFixed(3);
  parts.push(`${voice.join("")}amix=inputs=${voice.length}:normalize=0,apad,atrim=0:${dur}[vo]`);
  let bus = "[vo]";
  if (music.length) {
    parts.push(`[vo]asplit=2[vo1][key]`);
    parts.push(`${music.join("")}amix=inputs=${music.length}:normalize=0,atrim=0:${dur}[mus]`);
    parts.push(`[mus][key]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350:makeup=1[duck]`);
    parts.push(`[vo1][duck]amix=inputs=2:normalize=0[vm]`);
    bus = "[vm]";
  }
  if (sfx.length) {
    parts.push(`${bus}${sfx.join("")}amix=inputs=${sfx.length + 1}:normalize=0[pre]`);
    bus = "[pre]";
  }
  parts.push(`${bus}loudnorm=I=${target.lufs}:TP=${target.truePeak}:LRA=11,alimiter=limit=${Math.pow(10, (target.truePeak - 0.3) / 20).toFixed(4)}:level=disabled,atrim=0:${dur}[out]`);
  await execOk(FFMPEG, ["-y", "-hide_banner", ...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le", out], { timeoutMs: 15 * 60_000 });
  return out;
}

/** Replace a video's audio with a mixed track. */
export async function muxAudio(video: string, audio: string, out: string): Promise<string> {
  await execOk(FFMPEG, ["-y", "-hide_banner", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
  return out;
}

export async function hasAudio(file: string): Promise<boolean> {
  const r = await exec(FFMPEG, ["-hide_banner", "-i", file]);
  return /Stream #\d+:\d+.*Audio:/.test(r.stderr);
}
