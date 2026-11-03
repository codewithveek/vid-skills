/**
 * Client-side token bucket. Keeps a single isolate/process under a provider's
 * published request rate (Pexels 200/h, Unsplash 50/h demo, TikTok init 6/min…)
 * instead of discovering limits through 429s. For a global limit across many
 * Worker isolates, back it with a Durable Object (see apps/worker RateLimiterDO)
 * through the `RemoteLimiter` interface.
 */
export interface RemoteLimiter {
  /** resolves when a token was granted; may wait */
  acquire(key: string, perWindow: number, windowMs: number): Promise<void>;
}

export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
  ) {
    this.tokens = capacity;
  }
  private refill() {
    const now = Date.now();
    const add = ((now - this.last) / this.windowMs) * this.capacity;
    if (add > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + add);
      this.last = now;
    }
  }
  take(signal?: AbortSignal): Promise<void> {
    const run = async () => {
      for (;;) {
        if (signal?.aborted) throw new Error("aborted");
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const need = ((1 - this.tokens) / this.capacity) * this.windowMs;
        await new Promise((r) => setTimeout(r, Math.ceil(need) + 5));
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}
