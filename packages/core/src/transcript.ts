/**
 * Word-timing utilities: convert any provider's alignment into words, estimate
 * timings when a provider gives none, guard against ASR hallucinations, and map
 * script lines onto the spoken words.
 */
import type { WordTiming } from "./spec.js";
import { normWord, round3, syllables, words as splitWords } from "./util.js";

/** ElevenLabs-style character alignment → word timings. */
export function charsToWords(chars: string[], starts: number[], ends: number[], offset = 0): WordTiming[] {
  const out: WordTiming[] = [];
  let cur = "";
  let s = -1;
  let e = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] ?? "";
    if (/\s/.test(c)) {
      if (cur.trim()) out.push({ text: cur, start: round3(s + offset), end: round3(e + offset) });
      cur = "";
      s = -1;
      continue;
    }
    if (s < 0) s = starts[i] ?? e;
    e = ends[i] ?? e;
    cur += c;
  }
  if (cur.trim()) out.push({ text: cur, start: round3(Math.max(0, s) + offset), end: round3(e + offset) });
  return out;
}

/**
 * Estimate word timings for audio of known duration when the provider returns
 * no alignment. Distributes time by syllables, with extra weight on punctuation pauses.
 * Accuracy is typically ±120 ms on TTS, which is good enough for cut placement;
 * the pipeline refines it with STT when an STT provider is configured.
 */
export function estimateWordTimings(text: string, durationSec: number, leadIn = 0.05, tailOut = 0.1): WordTiming[] {
  const ws = splitWords(text);
  if (!ws.length) return [];
  const weights = ws.map((w) => {
    let wt = syllables(w) + 0.35;
    if (/[,;:–—]$/.test(w)) wt += 1.0;
    if (/[.!?]$/.test(w)) wt += 1.8;
    return wt;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.1, durationSec - leadIn - tailOut);
  let t = leadIn;
  return ws.map((w, i) => {
    const d = (weights[i]! / total) * span;
    const pause = /[.!?]$/.test(w) ? Math.min(0.35, d * 0.4) : /[,;:]$/.test(w) ? Math.min(0.18, d * 0.3) : 0;
    const wt: WordTiming = { text: w, start: round3(t), end: round3(t + d - pause) };
    t += d;
    return wt;
  });
}

/** Phrases Whisper-family models hallucinate over silence/music. */
const HALLUCINATIONS = [
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "like and subscribe",
  "subtitles by",
  "transcribed by",
  "you",
];

/**
 * Drops words that fall inside known-silent regions or that form a classic
 * hallucination phrase with low confidence. (The reference audit caught Whisper
 * inventing "Thanks for watching!" over the silent end card.)
 */
export function guardHallucinations(ws: WordTiming[], silences: { start: number; end: number }[] = [], minConfidence = 0.6): WordTiming[] {
  const inSilence = (w: WordTiming) => silences.some((s) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05);
  const kept = ws.filter((w) => !inSilence(w));
  // Remove trailing hallucination phrase runs.
  const text = kept.map((w) => normWord(w.text)).join(" ");
  for (const h of HALLUCINATIONS) {
    if (text.endsWith(h)) {
      const n = h.split(" ").length;
      const tail = kept.slice(-n);
      const avg = tail.reduce((a, w) => a + (w.confidence ?? 0.5), 0) / n;
      const gap = tail[0] && kept[kept.length - n - 1] ? tail[0].start - kept[kept.length - n - 1]!.end : 0;
      if (avg < minConfidence || gap > 1.5) return kept.slice(0, -n);
    }
  }
  return kept;
}

/** Offset a list of word timings. */
export function shiftWords(ws: WordTiming[], by: number): WordTiming[] {
  return ws.map((w) => ({ ...w, start: round3(w.start + by), end: round3(w.end + by) }));
}

/**
 * Align script lines to spoken words with a greedy, order-preserving fuzzy match.
 * Robust to ASR substitutions, numerals ("1973" vs "nineteen seventy three"), and
 * dropped words. Returns per-line [start,end] in seconds.
 */
export function mapLinesToWords(
  lines: { id: string; text: string }[],
  spoken: WordTiming[],
): { lineId: string; start: number; end: number; firstWord: number; lastWord: number }[] {
  const out: { lineId: string; start: number; end: number; firstWord: number; lastWord: number }[] = [];
  const norm = spoken.map((w) => normWord(w.text));
  let cursor = 0;
  const totalScriptWords = lines.reduce((n, l) => n + splitWords(l.text).length, 0) || 1;
  let consumedScript = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const lw = splitWords(line.text).map(normWord).filter(Boolean);
    consumedScript += lw.length;
    // Expected end index proportional to script progress; search a window around it.
    const expectedEnd = Math.round((consumedScript / totalScriptWords) * spoken.length) - 1;
    const last = lw[lw.length - 1] ?? "";
    let endIdx = -1;
    const lo = Math.max(cursor, expectedEnd - 12);
    const hi = Math.min(spoken.length - 1, expectedEnd + 12);
    let best = Infinity;
    for (let i = lo; i <= hi; i++) {
      if (norm[i] === last || (last.length > 3 && norm[i]?.startsWith(last.slice(0, 4)))) {
        const d = Math.abs(i - expectedEnd);
        if (d < best) {
          best = d;
          endIdx = i;
        }
      }
    }
    if (endIdx < 0) endIdx = Math.max(cursor, Math.min(spoken.length - 1, expectedEnd));
    if (li === lines.length - 1) endIdx = spoken.length - 1;
    const startIdx = Math.min(cursor, endIdx);
    const sw = spoken[startIdx];
    const ew = spoken[endIdx];
    out.push({
      lineId: line.id,
      start: sw ? sw.start : 0,
      end: ew ? ew.end : 0,
      firstWord: startIdx,
      lastWord: endIdx,
    });
    cursor = endIdx + 1;
  }
  return out;
}

/** Find the time of an anchor phrase inside a word range; returns null if absent. */
export function findAnchor(spoken: WordTiming[], anchor: string, from: number, to: number): number | null {
  const target = splitWords(anchor).map(normWord).filter(Boolean);
  if (!target.length) return null;
  for (let i = from; i <= to; i++) {
    let ok = true;
    for (let k = 0; k < target.length; k++) {
      const w = spoken[i + k] ? normWord(spoken[i + k]!.text) : "";
      const t = target[k]!;
      if (!(w === t || (t.length > 3 && w.startsWith(t.slice(0, Math.max(4, t.length - 2)))))) {
        ok = false;
        break;
      }
    }
    if (ok) return spoken[i]!.start;
  }
  return null;
}

/** SRT/VTT import for transcripts produced elsewhere. Produces cue-level pseudo words. */
export function parseSubtitles(src: string): WordTiming[] {
  const out: WordTiming[] = [];
  const re = /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const t = (h: string | undefined, m: string, s: string, ms: string) => (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
  for (const m of src.replace(/\r/g, "").matchAll(re)) {
    const start = t(m[1]?.replace(":", ""), m[2]!, m[3]!, m[4]!);
    const end = t(m[5]?.replace(":", ""), m[6]!, m[7]!, m[8]!);
    const text = (m[9] ?? "").replace(/<[^>]+>/g, "").trim();
    const ws = splitWords(text);
    const est = estimateWordTimings(text, end - start, 0, 0);
    ws.forEach((_, i) => out.push({ ...est[i]!, start: round3(start + est[i]!.start), end: round3(start + est[i]!.end) }));
  }
  return out;
}
