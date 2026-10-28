/** Small runtime-agnostic helpers (no Node built-ins, so they run on Workers, Deno, Bun and browsers). */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round a time to the nearest frame boundary. */
export function toFrame(sec: number, fps: number): number {
  return Math.round(sec * fps) / fps;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function slug(s: string, max = 48): string {
  const out = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return out || "x";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for an HTML attribute value wrapped in double quotes. */
export function attrJson(v: unknown): string {
  return escapeHtml(JSON.stringify(v));
}

/** Safe embedding of JSON inside a <script> tag. */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable JSON stringify (sorted keys), used for cache keys. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function newId(prefix = "job"): string {
  const t = Date.now().toString(36);
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}_${t}${[...r].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 8)}`;
}

/** Deterministic PRNG (mulberry32) so compositions never use unseeded Math.random. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Normalise a word for fuzzy matching between script text and ASR/TTS alignment. */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9%$]+/g, "");
}

export function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Rough English syllable count, used for duration estimates when no alignment is available. */
export function syllables(word: string): number {
  const w = normWord(word);
  if (!w) return 0;
  if (/^\d+$/.test(w)) return Math.max(1, w.length); // digits read as several syllables
  const m = w.replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Truncate at a word boundary and append an ellipsis if needed (counts UTF-16 units like most APIs). */
export function truncateWords(s: string, max: number, ellipsis = "…"): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(0, max - ellipsis.length));
  const at = cut.lastIndexOf(" ");
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "") + ellipsis;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
