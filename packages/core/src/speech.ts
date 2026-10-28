/**
 * Speech normalization: rewrite text so ANY TTS engine reads it the way a
 * narrator would, while captions keep the original digits.
 *
 * Many engines (Kokoro/misaki, Piper, some cloud voices) read "1868" as
 * "one thousand eight hundred sixty-eight". We convert years, decades,
 * percentages, decimals, currency and ordinals into words, and keep a token map
 * so word timings for the spoken text can be folded back onto the display words
 * ("eighteen" + "sixty-eight" → "1868").
 */
import type { WordTiming } from "./spec.js";
import { round3 } from "./util.js";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–99 in words ("sixty-eight"). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t]!;
}

/** Cardinal number in words (0 – 999,999,999,999). */
export function cardinal(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return `minus ${cardinal(-n)}`;
  n = Math.floor(n);
  if (n < 100) return twoDigits(n);
  const parts: string[] = [];
  const scales: [number, string][] = [
    [1e9, "billion"],
    [1e6, "million"],
    [1e3, "thousand"],
  ];
  for (const [v, name] of scales) {
    if (n >= v) {
      parts.push(`${cardinal(Math.floor(n / v))} ${name}`);
      n %= v;
    }
  }
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n > 0) parts.push(parts.length ? `and ${twoDigits(n)}` : twoDigits(n));
  return parts.join(" ");
}

/** A year the way people say it: 1868 → "eighteen sixty-eight", 1905 → "nineteen oh five", 2004 → "two thousand four", 2024 → "twenty twenty-four". */
export function yearWords(y: number): string {
  if (y >= 2000 && y <= 2009) return y === 2000 ? "two thousand" : `two thousand ${ONES[y - 2000]}`;
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${twoDigits(hi)} hundred`;
  if (lo < 10) return `${twoDigits(hi)} oh ${ONES[lo]}`;
  return `${twoDigits(hi)} ${twoDigits(lo)}`;
}

/** Plural for decades: "sixty" → "sixties", "twenty" → "twenties", "hundred" → "hundreds". */
function pluralize(w: string): string {
  return w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`;
}

const ORD: Record<string, string> = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function ordinal(n: number): string {
  const w = cardinal(n);
  const m = /(\w+)$/.exec(w)!;
  const last = m[1]!;
  const o = ORD[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return w.slice(0, m.index) + o;
}

const YEAR_CUES = /^(in|by|since|from|until|till|to|of|circa|c\.|around|before|after|during|year|back|early|late|mid|summer|winter|spring|autumn|fall|january|february|march|april|may|june|july|august|september|october|november|december)$/i;
const MONTHS = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?$/i;

/** Speak one whitespace-delimited token, given its neighbours. Returns null if unchanged. */
/** Words after which a Roman numeral is a plain number: "Mark II", "World War I", "Apollo XI". */
const NUMERAL_CUES = new Set(["mark", "war", "apollo", "model", "type", "part", "phase", "chapter", "volume", "vol", "class", "level", "stage", "series", "episode", "title", "act", "gen", "generation", "pioneer", "voyager", "gemini", "saturn", "falcon"]);
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanValue(r: string): number | null {
  if (!/^(?=[IVXLC])(C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(r)) return null;
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]!]!;
    const nx = ROMAN[r[i + 1] ?? ""] ?? 0;
    n += v < nx ? -v : v;
  }
  return n > 0 && n < 200 ? n : null;
}

function speakToken(tok: string, prev: string, next: string): string | null {
  const m = /^([("'“‘]*)(.*?)([)"'”’.,;:!?…]*)$/.exec(tok);
  if (!m) return null;
  const [, lead, core, trail] = m as unknown as [string, string, string, string];
  let out: string | null = null;

  // Roman numerals after a cue word ("Mark II" → "Mark two"); TTS engines read them as letters.
  const prevWord = prev.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (NUMERAL_CUES.has(prevWord) && /^[IVXLC]+$/.test(core)) {
    const v = romanValue(core);
    if (v !== null) return `${lead}${cardinal(v)}${trail}`;
  }

  // Decades: 1980s, 1980's, '90s
  let d = /^(1[1-9]|20)(\d)0'?s$/.exec(core);
  if (d) {
    const y = Number(`${d[1]}${d[2]}0`);
    const w = yearWords(y).split(" ");
    w[w.length - 1] = pluralize(w[w.length - 1]!);
    out = w.join(" ");
  }
  d = d ? null : /^'(\d)0s$/.exec(core);
  if (!out && d) out = pluralize(TENS[Number(d[1])] || "zero");

  // Years: 1100–2099, 4 digits, no separators. Treated as a year when a cue precedes it,
  // a month/day sits next to it, or it stands alone before punctuation/end (not "1500 people").
  if (!out && /^(1[1-9]\d\d|20\d\d)$/.test(core)) {
    const p = prev.replace(/[^\w.]/g, "");
    const n = next.replace(/[^\w]/g, "");
    const looksYear = YEAR_CUES.test(p) || MONTHS.test(p) || /^\d{1,2}(st|nd|rd|th)?$/.test(p) || trail.length > 0 || !n || /^(and|or|to|through|when|where|was|were|is|the|a|an|it|they|he|she|we|you|i)$/i.test(n);
    if (looksYear) out = yearWords(Number(core));
  }

  // Ordinals: 1st, 22nd, 103rd
  if (!out) {
    const o = /^(\d{1,9})(st|nd|rd|th)$/i.exec(core);
    if (o) out = ordinal(Number(o[1]));
  }
  // Currency: $5, $1.5M, €20, £3bn
  if (!out) {
    const c = /^([$€£])(\d[\d,]*(?:\.\d+)?)(k|m|bn|b|million|billion)?$/i.exec(core);
    if (c) {
      const unit = c[1] === "$" ? "dollars" : c[1] === "€" ? "euros" : "pounds";
      const scale = { k: "thousand", m: "million", million: "million", b: "billion", bn: "billion", billion: "billion" }[(c[3] ?? "").toLowerCase()];
      out = `${numberWords(c[2]!)}${scale ? ` ${scale}` : ""} ${unit}`;
    }
  }
  // Percent: 45%, 2.5%
  if (!out) {
    const pc = /^(\d[\d,]*(?:\.\d+)?)%$/.exec(core);
    if (pc) out = `${numberWords(pc[1]!)} percent`;
  }
  // Plain numbers with separators or decimals: 1,000,000 / 1.44 / 25
  if (!out && /^\d[\d,]*(\.\d+)?$/.test(core) && /\d/.test(core)) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(core) && core.includes(",")) return null; // "1,2,3" lists: leave alone
    out = numberWords(core);
  }
  return out ? `${lead}${out}${trail}` : null;
}

function numberWords(s: string): string {
  const [int, frac] = s.replace(/,/g, "").split(".");
  const i = cardinal(Number(int));
  return frac ? `${i} point ${[...frac].map((d) => ONES[Number(d)]).join(" ")}` : i;
}

export interface SpeechText {
  /** Text to send to the TTS engine. */
  spoken: string;
  /** For each display token: the token and how many spoken tokens it became. */
  map: { display: string; spoken: number }[];
}

/** Normalize text for speech, keeping a display↔spoken token map. */
export function toSpeech(text: string): SpeechText {
  const toks = text.split(/\s+/).filter(Boolean);
  const map: SpeechText["map"] = [];
  const out: string[] = [];
  toks.forEach((tok, i) => {
    const s = speakToken(tok, toks[i - 1] ?? "", toks[i + 1] ?? "") ?? tok;
    const parts = s.split(/\s+/).filter(Boolean);
    out.push(...parts);
    map.push({ display: tok, spoken: parts.length });
  });
  return { spoken: out.join(" "), map };
}

/** Merge several SpeechText results (one per script line) into one. */
export function joinSpeech(parts: SpeechText[]): SpeechText {
  return { spoken: parts.map((p) => p.spoken).join(" "), map: parts.flatMap((p) => p.map) };
}

/**
 * Fold word timings of the spoken text back onto display tokens, so captions and
 * anchor matching see "1868" again. Returns the input unchanged when the word
 * counts don't line up (e.g. an STT engine split or merged words differently).
 */
export function remapToDisplay(words: WordTiming[], sp: SpeechText): WordTiming[] {
  const expected = sp.map.reduce((n, m) => n + m.spoken, 0);
  // STT prompted with the display text often writes digits back ("1868"): counts match the display tokens.
  if (words.length === sp.map.length && words.length !== expected) return words.map((w, i) => ({ ...w, text: sp.map[i]!.display }));
  if (words.length !== expected) return words;
  if (sp.map.every((m) => m.spoken === 1)) {
    // Counts match 1:1: just restore the display text.
    return words.map((w, i) => ({ ...w, text: sp.map[i]!.display }));
  }
  const out: WordTiming[] = [];
  let k = 0;
  for (const m of sp.map) {
    const group = words.slice(k, k + m.spoken);
    k += m.spoken;
    if (!group.length) continue;
    const conf = group.map((g) => g.confidence).filter((c): c is number => c !== undefined);
    out.push({ text: m.display, start: round3(group[0]!.start), end: round3(group[group.length - 1]!.end), ...(conf.length ? { confidence: Math.min(...conf) } : {}) });
  }
  return out;
}
