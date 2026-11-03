/**
 * Remote render backend: ships a compiled HyperFrames project to a render node
 * (`@vid-skills/renderer` server in a Cloudflare Container, Docker, Cloud Run, Fly…)
 * as multipart form-data (manifest JSON + one part per file) and stores the MP4.
 * Works from Workers: pass `fetcher` to call a Container/Service binding directly.
 */
import type { RenderBackend, RenderRequest, RenderResult, Storage } from "@vid-skills/core";
import { ProviderError } from "./http.js";

export interface HttpRenderOptions {
  url: string; // e.g. https://render.example.com  (POST {url}/render)
  token?: string;
  /** Use a binding's fetch (Container DO stub, service binding) instead of global fetch. */
  fetcher?: { fetch(req: Request): Promise<Response> };
  timeoutMs?: number;
  /**
   * When set, assets are sent as URLs the render node downloads itself (e.g. signed
   * Worker /files URLs) instead of being inlined: keeps Worker memory flat for big media.
   */
  assetUrl?: (key: string) => Promise<string>;
}

export class HttpRenderBackend implements RenderBackend {
  readonly id = "http-render";
  constructor(private readonly o: HttpRenderOptions) {}
  async render(req: RenderRequest, storage: Storage, outKey: string): Promise<RenderResult> {
    const fd = new FormData();
    const manifest = { fps: req.fps, quality: req.quality, format: req.format ?? "mp4", master: req.master, files: [] as string[] };
    for (const [path, content] of Object.entries(req.files)) {
      manifest.files.push(path);
      fd.append(`file:${path}`, new Blob([content as unknown as ArrayBuffer]), path);
    }
    const assetUrls: Record<string, string> = {};
    for (const [path, key] of Object.entries(req.assetKeys ?? {})) {
      if (this.o.assetUrl) {
        assetUrls[path] = await this.o.assetUrl(key);
        continue;
      }
      const bytes = await storage.get(key);
      if (!bytes) throw new ProviderError(`render: missing asset ${key}`, this.id, undefined, false);
      manifest.files.push(path);
      fd.append(`file:${path}`, new Blob([bytes as unknown as ArrayBuffer]), path);
    }
    fd.set("manifest", JSON.stringify({ ...manifest, assetUrls }));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error("render timeout")), this.o.timeoutMs ?? 45 * 60_000);
    req.signal?.addEventListener("abort", () => ctl.abort(req.signal?.reason), { once: true });
    try {
      const r = new Request(`${this.o.url.replace(/\/$/, "")}/render`, { method: "POST", body: fd, headers: this.o.token ? { authorization: `Bearer ${this.o.token}` } : {}, signal: ctl.signal });
      const res = this.o.fetcher ? await this.o.fetcher.fetch(r) : await fetch(r);
      if (!res.ok) throw new ProviderError(`render node: HTTP ${res.status} ${(await res.text()).slice(0, 2000)}`, this.id, res.status, res.status >= 500);
      const ct = res.headers.get("content-type") ?? "video/mp4";
      const len = Number(res.headers.get("content-length") ?? 0) || undefined;
      if (storage.putStream && res.body) await storage.putStream(outKey, res.body, ct, len);
      else await storage.put(outKey, new Uint8Array(await res.arrayBuffer()), ct);
      const num = (h: string) => {
        const v = res.headers.get(h);
        return v === null ? undefined : Number(v);
      };
      return { storageKey: outKey, durationSec: num("x-duration"), measuredLufs: num("x-lufs"), measuredTruePeak: num("x-true-peak") };
    } finally {
      clearTimeout(timer);
    }
  }
}
