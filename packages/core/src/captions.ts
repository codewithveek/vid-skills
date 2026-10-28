import type { CaptionCue, WordTiming } from "./spec.js";
import type { StylePack } from "./styles/types.js";
import { normWord, round3 } from "./util.js";

/**
 * Groups word timings into short, readable caption cues (vertical video
 * convention: ≤ 4 words, ≤ 24 chars, ≤ 1.6 s, break on punctuation and pauses).
 */
export function buildCaptionCues(ws: WordTiming[], style: StylePack, emphasisWords: string[] = []): CaptionCue[] {
  const { maxWordsPerCue, maxCharsPerCue, maxCueSec } = style.captions;
  const emph = new Set(emphasisWords.map(normWord).filter(Boolean));
  const cues: CaptionCue[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (!cur.length) return;
    const emphasis: number[] = [];
    cur.forEach((w, i) => {
      if (emph.has(normWord(w.text))) emphasis.push(i);
    });
    cues.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur, emphasis });
    cur = [];
  };
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    const gap = prev ? w.start - prev.end : 0;
    if (cur.length && (cur.length >= maxWordsPerCue || chars > maxCharsPerCue || w.end - cur[0]!.start > maxCueSec || gap > 0.35)) flush();
    cur.push(w);
    if (/[.!?;:]$/.test(w.text) || (/[,–—]$/.test(w.text) && cur.length >= 2)) flush();
  }
  flush();
  // Extend each cue to the next one's start (max +0.4 s) so captions don't flicker between words.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const c = cues[i]!;
    c.end = round3(next ? Math.min(next.start, c.end + 0.4) : c.end + 0.4);
  }
  return cues;
}

function ts(sec: number, sep: "," | "."): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${ts(c.start, ",")} --> ${ts(c.end, ",")}\n${c.words.map((w) => w.text).join(" ")}\n`)
    .join("\n");
}

export function toVtt(cues: CaptionCue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${ts(c.start, ".")} --> ${ts(c.end, ".")}\n${c.words.map((w) => w.text).join(" ")}\n`).join("\n")}`;
}
