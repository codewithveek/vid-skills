/**
 * Resilient HTTP for provider calls (fetch-only, runs on Workers):
 *  - timeouts and caller abort signals
 *  - retries with exponential backoff + full jitter on network errors, 408/409/425/429/5xx
 *  - honours Retry-After (seconds or HTTP date) and x-ratelimit-reset style headers
 *  - redacts secrets from error messages
 *  - optional per-key token-bucket rate limiting
 */
import { RateLimiter } from "./ratelimit.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
    readonly body?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface RetryPolicy {
  retries: number;
  baseMs: number;
  maxMs: number;
  timeoutMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { retries: 4, baseMs: 800, maxMs: 30_000, timeoutMs: 120_000 };

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);
const SECRET_RE = /((?:api[_-]?key|token|key|authorization|secret|signature)=?["':\s]*)([A-Za-z0-9_\-.~+/]{12,})/gi;

export function redact(s: string): string {
  return s.replace(SECRET_RE, "$1[redacted]");
}

function retryAfterMs(res: Response): number | null {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n)) return n * 1000;
    const d = Date.parse(ra);
    if (Number.isFinite(d)) return Math.max(0, d - Date.now());
  }
  for (const h of ["x-ratelimit-reset-requests", "x-ratelimit-reset", "ratelimit-reset"]) {
    const v = res.headers.get(h);
    if (!v) continue;
    const m = /^([\d.]+)(ms|s|m)?$/.exec(v.trim());
    if (m) {
      const n = Number(m[1]);
      // epoch seconds vs relative seconds
      if (!m[2] && n > 1e9) return Math.max(0, n * 1000 - Date.now());
      return m[2] === "ms" ? n : m[2] === "m" ? n * 60_000 : n * 1000;
    }
  }
  return null;
}

const limiters = new Map<string, RateLimiter>();
export function limiterFor(key: string, perMinute: number): RateLimiter {
  let l = limiters.get(key);
  if (!l) {
    // Sub-1/min rates (e.g. Unsplash demo: 50/hour) are expressed per hour so the bucket can hold a whole token.
    l = perMinute >= 1 ? new RateLimiter(perMinute, 60_000) : new RateLimiter(Math.max(1, Math.round(perMinute * 60)), 3_600_000);
    limiters.set(key, l);
  }
  return l;
}

export interface RequestOptions extends RequestInit {
  provider: string;
  retry?: Partial<RetryPolicy>;
  /** e.g. "pexels" — requests sharing a key share a client-side rate limit */
  rateKey?: string;
  ratePerMinute?: number;
  signal?: AbortSignal;
}

export async function request(url: string, o: RequestOptions): Promise<Response> {
  const pol = { ...DEFAULT_RETRY, ...(o.retry ?? {}) };
  let attempt = 0;
  for (;;) {
    if (o.rateKey && o.ratePerMinute) await limiterFor(o.rateKey, o.ratePerMinute).take(o.signal);
    const ctl = new AbortController();
    const onAbort = () => ctl.abort(o.signal?.reason);
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${pol.timeoutMs} ms`)), pol.timeoutMs);
    let res: Response | undefined;
    let netErr: unknown;
    try {
      res = await fetch(url, { ...o, signal: ctl.signal });
    } catch (e) {
      netErr = e;
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
    if (o.signal?.aborted) throw new ProviderError(`${o.provider}: aborted`, o.provider, undefined, false);
    if (res && res.ok) return res;
    const status = res?.status;
    const retryable = !res || RETRYABLE.has(status!);
    if (!retryable || attempt >= pol.retries) {
      const body = res ? await res.text().catch(() => "") : "";
      const msg = res ? `${o.provider}: HTTP ${status} ${redact(body.slice(0, 800))}` : `${o.provider}: network error ${redact(String(netErr))}`;
      throw new ProviderError(msg, o.provider, status, retryable, body.slice(0, 4000));
    }
    const hinted = res ? retryAfterMs(res) : null;
    const backoff = Math.min(pol.maxMs, pol.baseMs * 2 ** attempt);
    const wait = hinted !== null ? Math.min(pol.maxMs * 4, hinted + 250) : Math.random() * backoff + pol.baseMs / 2;
    if (res) await res.body?.cancel().catch(() => {});
    attempt++;
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function requestJson<T = unknown>(url: string, o: RequestOptions): Promise<T> {
  const res = await request(url, o);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderError(`${o.provider}: invalid JSON response: ${redact(text.slice(0, 300))}`, o.provider, res.status, false, text.slice(0, 2000));
  }
}

export async function requestBytes(url: string, o: RequestOptions): Promise<{ bytes: Uint8Array; mime: string; headers: Headers }> {
  const res = await request(url, o);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), headers: res.headers };
}

export function jsonBody(v: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(v), headers: { "content-type": "application/json" } };
}

/** Poll until `done` returns a value or the deadline passes (async job APIs). */
export async function poll<T>(fn: () => Promise<T | null>, o: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal; provider: string }): Promise<T> {
  const deadline = Date.now() + (o.timeoutMs ?? 15 * 60_000);
  let interval = o.intervalMs ?? 2000;
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() > deadline) throw new ProviderError(`${o.provider}: job timed out`, o.provider, undefined, true);
    if (o.signal?.aborted) throw new ProviderError(`${o.provider}: aborted`, o.provider, undefined, false);
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.3, 15_000);
  }
}

/** Find the first URL in an arbitrary JSON payload (async model hosts return many shapes). */
export function findUrl(v: unknown, pred: (u: string) => boolean = () => true): string | null {
  if (typeof v === "string") return /^https?:\/\//.test(v) && pred(v) ? v : null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = findUrl(x, pred);
      if (u) return u;
    }
    return null;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) {
      const u = findUrl(x, pred);
      if (u) return u;
    }
  }
  return null;
}
