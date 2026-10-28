/**
 * The timing engine turns script + storyboard + voice alignment into a
 * frame-exact timeline. The voice is the clock: every cut lands on its anchor
 * word (as in the reference, where each noun gets its own shot within ~0.3 s).
 * No LLM is involved here; timing is deterministic, so small models can't break it.
 */
import { buildCaptionCues } from "./captions.js";
import type { Script, Storyboard, TimedScene, Timeline, VoiceTrack, VideoBrief, AudioClip } from "./spec.js";
import type { StylePack } from "./styles/types.js";
import { findAnchor } from "./transcript.js";
import { clamp, round3, toFrame } from "./util.js";

export interface TimelineInput {
  brief: VideoBrief;
  script: Script;
  storyboard: Storyboard;
  voice: VoiceTrack;
  style: StylePack;
  /** shotId -> resolved asset ids */
  shotAssets: Record<string, string[]>;
  audio?: AudioClip[];
}

const TAIL_SCENES = new Set(["endcard"]);

export function buildTimeline(input: TimelineInput): Timeline {
  const { brief, script, storyboard, voice, style } = input;
  const fps = style.fps;
  const canvas = style.canvas[brief.aspect] ?? style.canvas["9:16"]!;
  const { minShotSec, cutLeadSec, montagePerItemSec } = style.motion;

  const spanByLine = new Map(voice.lineSpans.map((s) => [s.lineId, s]));
  const lineOrder = script.beats.flatMap((b) => b.lines.map((l) => l.id));

  // Word index range per line, for anchor search.
  const wordRange = new Map<string, [number, number]>();
  for (const span of voice.lineSpans) {
    let a = voice.words.findIndex((w) => w.end > span.start - 0.01);
    let b = voice.words.length - 1;
    for (let i = voice.words.length - 1; i >= 0; i--) {
      if (voice.words[i]!.start < span.end + 0.01) {
        b = i;
        break;
      }
    }
    if (a < 0) a = 0;
    wordRange.set(span.lineId, [a, Math.max(a, b)]);
  }

  const body = storyboard.shots.filter((s) => !TAIL_SCENES.has(s.scene.type));
  const tail = storyboard.shots.filter((s) => TAIL_SCENES.has(s.scene.type));

  // 1. Desired start per shot.
  const byLine = new Map<string, typeof body>();
  for (const s of body) {
    const arr = byLine.get(s.lineId) ?? [];
    arr.push(s);
    byLine.set(s.lineId, arr);
  }
  const desired: { shot: (typeof body)[number]; start: number }[] = [];
  for (const lineId of lineOrder) {
    const shots = byLine.get(lineId);
    if (!shots?.length) continue;
    const span = spanByLine.get(lineId);
    if (!span) continue;
    const [wa, wb] = wordRange.get(lineId) ?? [0, voice.words.length - 1];
    shots.forEach((shot, i) => {
      let t: number | null = null;
      if (shot.anchor) t = findAnchor(voice.words, shot.anchor, wa, wb);
      if (t === null) t = span.start + ((span.end - span.start) * i) / shots.length;
      desired.push({ shot, start: Math.max(0, t - cutLeadSec) });
    });
  }
  // Shots whose line is unknown get appended after their predecessor.
  for (const s of body) if (!desired.find((d) => d.shot === s)) desired.push({ shot: s, start: desired.length ? desired[desired.length - 1]!.start + 1 : 0 });

  desired.sort((a, b) => a.start - b.start);
  if (desired[0]) desired[0].start = 0; // frame 0 is the hook: never black

  // 2. Enforce minimum spacing, quantize to frames.
  for (let i = 1; i < desired.length; i++) {
    const prev = desired[i - 1]!;
    desired[i]!.start = Math.max(desired[i]!.start, prev.start + minShotSec);
  }
  const voiceEnd = voice.durationSec;
  const bodyEnd = Math.max(voiceEnd + 0.35, (desired[desired.length - 1]?.start ?? 0) + minShotSec);

  /**
   * Montage items cut on the list words when the line enumerates them
   * ("Phones, laptops, consoles, …" → one item per comma part, as in the reference);
   * otherwise they are spread evenly at 0.2–0.6 s each.
   */
  const fitMontage = (scene: Extract<Storyboard["shots"][number]["scene"], { type: "montage" }>, start: number, duration: number, lineId: string) => {
    const lineText = script.beats.flatMap((b) => b.lines).find((l) => l.id === lineId)?.text ?? "";
    const parts = lineText.split(/[,;]\s*|\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
    const [wa, wb] = wordRange.get(lineId) ?? [0, voice.words.length - 1];
    const times: number[] = [];
    if (parts.length >= 3) {
      for (const p of parts.slice(0, scene.items.length)) {
        const first = p.split(/\s+/)[0] ?? "";
        const t = findAnchor(voice.words, first, wa, wb);
        if (t === null) break;
        const rel = round3(Math.max(0, t - cutLeadSec - start));
        if (rel >= duration - 0.12 || (times.length && rel <= times[times.length - 1]! + 0.1)) break;
        times.push(times.length ? rel : 0);
      }
    }
    if (times.length >= 2) return { items: scene.items.slice(0, times.length), itemTimes: times, perItemSec: scene.perItemSec };
    const per = clamp(duration / scene.items.length, Math.min(montagePerItemSec, scene.perItemSec), 0.6);
    const count = Math.max(2, Math.min(scene.items.length, Math.floor(duration / per + 1e-6)));
    return { items: scene.items.slice(0, count), itemTimes: Array.from({ length: count }, (_, k) => round3(k * per)), perItemSec: round3(per) };
  };

  const scenes: TimedScene[] = desired.map((d, i) => {
    const start = toFrame(d.start, fps);
    const end = toFrame(i + 1 < desired.length ? desired[i + 1]!.start : bodyEnd, fps);
    let scene = d.shot.scene;
    let duration = Math.max(1 / fps, end - start);
    if (scene.type === "montage") {
      scene = { ...scene, ...fitMontage(scene, start, duration, d.shot.lineId) };
    }
    duration = round3(duration);
    return { id: d.shot.id, start: round3(start), duration, scene, assets: input.shotAssets[d.shot.id] ?? [], lineId: d.shot.lineId };
  });

  // 3. Tail scenes (end card) after the voice.
  let t = toFrame(bodyEnd, fps);
  for (const s of tail) {
    const dur = 2.5; // a closing line needs ≥ 2 s on screen
    scenes.push({ id: s.id, start: round3(t), duration: dur, scene: s.scene, assets: input.shotAssets[s.id] ?? [], lineId: s.lineId });
    t = toFrame(t + dur, fps);
  }
  const durationSec = round3(Math.max(t, bodyEnd));

  const emphasis = script.beats.flatMap((b) => b.lines.flatMap((l) => l.emphasis));
  const captions = brief.captions ? buildCaptionCues(voice.words, style, emphasis) : [];

  return {
    fps,
    width: canvas.width,
    height: canvas.height,
    durationSec,
    headline: brief.headline ?? script.headline,
    handle: brief.handle,
    scenes,
    captions,
    audio: input.audio ?? [],
    style: style.id,
  };
}

/** Shots whose scenes are visible at time t (for QA and previews). */
export function scenesAt(tl: Timeline, t: number): TimedScene[] {
  return tl.scenes.filter((s) => t >= s.start && t < s.start + s.duration);
}
