/**
 * Sound design plan: voice, ducked music bed with deliberate drops before twist
 * beats, and few, exact SFX tied to visible actions. Mirrors the reference audit:
 * bed ≈ 13 dB under the voice, near-silence drops of 0.4–0.9 s before the twist
 * line, SFX only on on-screen actions (cuts are NOT whoosh-scored).
 */
import type { AudioClip, Script, TimedScene, VoiceTrack } from "./spec.js";
import type { StylePack } from "./styles/types.js";
import { round3 } from "./util.js";

export interface SfxCueAt {
  cue: string;
  at: number;
  sceneId: string;
}

/** Default action cues per scene type, chosen to match "every effect has a cause on screen". */
export function plannedSfx(scenes: TimedScene[], fps: number): SfxCueAt[] {
  const out: SfxCueAt[] = [];
  const frame = 1 / fps;
  for (const s of scenes) {
    const sc = s.scene;
    if (sc.sfx) {
      out.push({ cue: sc.sfx, at: s.start + frame, sceneId: s.id });
      continue;
    }
    switch (sc.type) {
      case "typewriter":
        out.push({ cue: "tick", at: s.start + frame, sceneId: s.id });
        break;
      case "cta":
        out.push({ cue: "pop", at: s.start + 0.33, sceneId: s.id });
        out.push({ cue: "click", at: s.start + Math.min(1.0, s.duration * 0.45), sceneId: s.id });
        break;
      case "document":
        if (sc.pageTurn) out.push({ cue: "swipe", at: s.start + frame, sceneId: s.id });
        break;
      case "diagram":
        if (sc.template === "toggle-switch" || sc.template === "button-cards") out.push({ cue: "click", at: s.start + Math.min(0.9, s.duration * 0.5), sceneId: s.id });
        break;
      case "stat":
        out.push({ cue: "pop", at: s.start + 0.25, sceneId: s.id });
        break;
      default:
        break;
    }
  }
  // Rotate takes and avoid stacking: keep ≥ 0.25 s between hits.
  out.sort((a, b) => a.at - b.at);
  const kept: SfxCueAt[] = [];
  for (const c of out) if (!kept.length || c.at - kept[kept.length - 1]!.at >= 0.25) kept.push(c);
  return kept;
}

export interface AudioPlanInput {
  script: Script;
  voice: VoiceTrack;
  scenes: TimedScene[];
  durationSec: number;
  style: StylePack;
  /** Music bed; looped with 1 s crossfades when shorter than the video (provider caps). */
  music?: { assetId: string; durationSec: number };
  /** cue -> list of asset ids (takes); rotated per hit */
  sfxAssets?: Record<string, string[]>;
  drops?: boolean;
}

export function buildAudioPlan(i: AudioPlanInput): AudioClip[] {
  const { style, voice } = i;
  const clips: AudioClip[] = voice.segments.map((s, k) => ({
    id: `voice-${k}`,
    assetId: s.assetId,
    role: "voice" as const,
    start: round3(s.start),
    duration: round3(s.durationSec),
    mediaStart: 0,
    volume: style.audio.voiceGain,
    fadeIn: 0,
    fadeOut: 0.03,
    automation: [],
  }));

  if (i.music) {
    const under = style.audio.bedUnderVoice;
    const open = style.audio.bedNoVoice;
    const pts: { t: number; v: number }[] = [{ t: 0, v: under }];
    // Duck: rise in long voice gaps (> 0.7 s), back down 80 ms before speech resumes.
    const ws = voice.words;
    for (let k = 0; k + 1 < ws.length; k++) {
      const gapStart = ws[k]!.end;
      const gapEnd = ws[k + 1]!.start;
      if (gapEnd - gapStart > 0.7) {
        pts.push({ t: gapStart + 0.08, v: under }, { t: gapStart + 0.3, v: open }, { t: gapEnd - 0.2, v: open }, { t: gapEnd - 0.08, v: under });
      }
    }
    // Drops: silence the bed for ~0.7 s right before the first line of a "drop" beat.
    if (i.drops !== false) {
      for (const beat of i.script.beats) {
        if (beat.musicCue !== "drop" || !beat.lines[0]) continue;
        const span = voice.lineSpans.find((s) => s.lineId === beat.lines[0]!.id);
        if (!span) continue;
        const a = Math.max(0, span.start - 0.85);
        pts.push({ t: a - 0.04, v: under }, { t: a, v: 0 }, { t: span.start - 0.05, v: 0 }, { t: span.start + 0.25, v: under });
      }
    }
    const end = i.durationSec;
    pts.push({ t: Math.max(0, voice.durationSec + 0.1), v: under }, { t: Math.max(0, voice.durationSec + 0.5), v: open }, { t: end, v: open });
    const global = normalizeAutomation(pts, end);
    const xf = 1;
    const len = Math.max(2, i.music.durationSec);
    let start = 0;
    let k = 0;
    while (start < end - 0.05 && k < 64) {
      const dur = Math.min(len, end - start);
      const last = start + dur >= end - 0.05;
      clips.push({
        id: `music-${k}`,
        assetId: i.music.assetId,
        role: "music",
        start: round3(start),
        duration: round3(dur),
        mediaStart: 0,
        volume: 1,
        fadeIn: k === 0 ? 0.3 : xf,
        fadeOut: last ? 1.0 : xf,
        automation: sliceAutomation(global, start, start + dur),
      });
      start += len - xf;
      k++;
    }
  }

  if (i.sfxAssets) {
    const used = new Map<string, number>();
    for (const c of plannedSfx(i.scenes, style.fps)) {
      const takes = i.sfxAssets[c.cue];
      if (!takes?.length) continue;
      const n = used.get(c.cue) ?? 0;
      used.set(c.cue, n + 1);
      clips.push({
        id: `sfx-${c.sceneId}-${c.cue}-${n}`.slice(0, 64),
        assetId: takes[n % takes.length]!,
        role: "sfx",
        start: round3(c.at),
        mediaStart: 0,
        volume: style.audio.sfxGain,
        fadeIn: 0,
        fadeOut: 0.05,
        automation: [],
      });
    }
  }
  return clips;
}

/** Sort, clamp, dedupe and cap automation points (HyperFrames allows 512 points per lane). */
export function normalizeAutomation(pts: { t: number; v: number }[], end: number): { t: number; v: number }[] {
  const sorted = pts
    .map((p) => ({ t: round3(Math.min(end, Math.max(0, p.t))), v: round3(Math.max(0, p.v)) }))
    .sort((a, b) => a.t - b.t);
  const out: { t: number; v: number }[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - p.t) < 0.001) last.v = p.v;
    else out.push(p);
  }
  if (out.length <= 512) return out;
  const step = out.length / 511;
  const thinned: { t: number; v: number }[] = [];
  for (let k = 0; k < 511; k++) thinned.push(out[Math.floor(k * step)]!);
  thinned.push(out[out.length - 1]!);
  return thinned;
}

/** Re-base a global automation lane onto a clip window [a,b] (HyperFrames lanes are clip-relative). */
export function sliceAutomation(pts: { t: number; v: number }[], a: number, b: number): { t: number; v: number }[] {
  const at = (t: number): number => {
    if (!pts.length) return 1;
    if (t <= pts[0]!.t) return pts[0]!.v;
    for (let k = 1; k < pts.length; k++) {
      const p0 = pts[k - 1]!;
      const p1 = pts[k]!;
      if (t <= p1.t) return p1.t === p0.t ? p1.v : p0.v + ((p1.v - p0.v) * (t - p0.t)) / (p1.t - p0.t);
    }
    return pts[pts.length - 1]!.v;
  };
  const out = [{ t: 0, v: round3(at(a)) }];
  for (const p of pts) if (p.t > a && p.t < b) out.push({ t: round3(p.t - a), v: p.v });
  out.push({ t: round3(b - a), v: round3(at(b)) });
  return normalizeAutomation(out, b - a);
}
