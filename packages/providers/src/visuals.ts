/** Stock search, image generation and video generation adapters. */
import { bytesFromBase64, type ImageGenRequest, type ImageProvider, type License, type StockProvider, type VideoGenProvider, type VideoGenRequest, type VisualCandidate } from "@vid-skills/core";
import { runHosted, type HostedModel } from "./hosted.js";
import { ProviderError, requestJson } from "./http.js";
import { runWorkersAi, type AiBinding } from "./llm.js";

type Q = Parameters<StockProvider["search"]>[0];

/* ============================ Stock ============================ */

/** Pexels: free commercial use, no attribution required (credit appreciated). 200 req/h, 20k/month. */
export class PexelsStock implements StockProvider {
  readonly id = "pexels";
  readonly kinds: ("image" | "video")[] = ["image", "video"];
  constructor(private readonly o: { apiKey: string }) {}
  async search(q: Q): Promise<VisualCandidate[]> {
    const lic = (url: string, who: string): License => ({ name: "Pexels License", url: "https://www.pexels.com/license/", attribution: `${who} via Pexels (${url})`, commercialUse: true, requiresAttribution: false });
    const common = { provider: this.id, headers: { authorization: this.o.apiKey }, rateKey: "pexels", ratePerMinute: 3, signal: q.signal, retry: { retries: 1, timeoutMs: 20_000 } };
    const orient = q.orientation ? `&orientation=${q.orientation}` : "";
    if (q.kind === "video") {
      const j = await requestJson<{ videos?: { id: number; url: string; duration: number; user?: { name: string }; video_files: { link: string; width: number; height: number; quality?: string; file_type?: string }[]; image?: string }[] }>(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(q.query)}&per_page=${q.limit ?? 8}${orient}&size=medium`,
        common,
      );
      return (j.videos ?? []).flatMap((v) => {
        // Pick the smallest rendition ≥ 1280 wide (keeps downloads small, quality fine for a 1080-wide window).
        const files = v.video_files.filter((f) => f.file_type === "video/mp4").sort((a, b) => a.width - b.width);
        const f = files.find((x) => Math.max(x.width, x.height) >= 1280) ?? files[files.length - 1];
        return f ? [{ id: `pexels-v${v.id}`, kind: "video" as const, url: f.link, previewUrl: v.image, width: f.width, height: f.height, durationSec: v.duration, provider: this.id, license: lic(v.url, v.user?.name ?? "Pexels") }] : [];
      });
    }
    const j = await requestJson<{ photos?: { id: number; url: string; width: number; height: number; alt?: string; photographer: string; src: Record<string, string> }[] }>(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(q.query)}&per_page=${q.limit ?? 8}${orient}`,
      common,
    );
    return (j.photos ?? []).map((p) => ({ id: `pexels-${p.id}`, kind: "image", url: p.src.large2x ?? p.src.original!, previewUrl: p.src.medium, width: p.width, height: p.height, description: p.alt, provider: this.id, license: lic(p.url, p.photographer) }));
  }
}

/** Pixabay: commercial use OK; results must be cached ≤ 24 h and files served from your own storage (we download). */
export class PixabayStock implements StockProvider {
  readonly id = "pixabay";
  readonly kinds: ("image" | "video")[] = ["image", "video"];
  constructor(private readonly o: { apiKey: string }) {}
  async search(q: Q): Promise<VisualCandidate[]> {
    const lic: License = { name: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/", commercialUse: true, requiresAttribution: false };
    const orient = q.orientation === "landscape" ? "horizontal" : q.orientation === "portrait" ? "vertical" : "all";
    const common = { provider: this.id, rateKey: "pixabay", ratePerMinute: 90, signal: q.signal, retry: { retries: 1, timeoutMs: 20_000 } };
    if (q.kind === "video") {
      const j = await requestJson<{ hits?: { id: number; duration: number; pageURL: string; videos: Record<string, { url: string; width: number; height: number }> }[] }>(`https://pixabay.com/api/videos/?key=${this.o.apiKey}&q=${encodeURIComponent(q.query)}&per_page=${Math.max(3, q.limit ?? 8)}&safesearch=true`, common);
      return (j.hits ?? []).flatMap((h) => {
        const v = h.videos.medium?.url ? h.videos.medium : (h.videos.large ?? h.videos.small);
        return v?.url ? [{ id: `pixabay-v${h.id}`, kind: "video" as const, url: v.url, width: v.width, height: v.height, durationSec: h.duration, provider: this.id, license: { ...lic, attribution: h.pageURL } }] : [];
      });
    }
    const j = await requestJson<{ hits?: { id: number; pageURL: string; largeImageURL: string; webformatURL: string; imageWidth: number; imageHeight: number; tags?: string; user?: string }[] }>(
      `https://pixabay.com/api/?key=${this.o.apiKey}&q=${encodeURIComponent(q.query)}&image_type=photo&orientation=${orient}&per_page=${Math.max(3, q.limit ?? 8)}&safesearch=true`,
      common,
    );
    return (j.hits ?? []).map((h) => ({ id: `pixabay-${h.id}`, kind: "image", url: h.largeImageURL, previewUrl: h.webformatURL, width: h.imageWidth, height: h.imageHeight, description: h.tags, provider: this.id, license: { ...lic, attribution: `${h.user ?? ""} ${h.pageURL}`.trim() } }));
  }
}

/** Unsplash: attribution and a download ping are required by the API guidelines (handled via downloadTrackingUrl). 50 req/h on demo keys. */
export class UnsplashStock implements StockProvider {
  readonly id = "unsplash";
  readonly kinds: ("image" | "video")[] = ["image"];
  constructor(private readonly o: { accessKey: string }) {}
  async search(q: Q): Promise<VisualCandidate[]> {
    if (q.kind !== "image") return [];
    const j = await requestJson<{ results?: { id: string; width: number; height: number; alt_description?: string; urls: Record<string, string>; links: { html: string; download_location: string }; user: { name: string } }[] }>(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q.query)}&per_page=${q.limit ?? 8}${q.orientation ? `&orientation=${q.orientation === "square" ? "squarish" : q.orientation}` : ""}&content_filter=high`,
      { provider: this.id, headers: { authorization: `Client-ID ${this.o.accessKey}`, "accept-version": "v1" }, rateKey: "unsplash", ratePerMinute: 0.8, signal: q.signal, retry: { retries: 1, timeoutMs: 20_000 } },
    );
    return (j.results ?? []).map((r) => ({
      id: `unsplash-${r.id}`,
      kind: "image",
      url: `${r.urls.raw}&w=1600&fm=jpg&q=82`,
      previewUrl: r.urls.small,
      width: r.width,
      height: r.height,
      description: r.alt_description,
      provider: this.id,
      license: { name: "Unsplash License", url: "https://unsplash.com/license", attribution: `Photo by ${r.user.name} on Unsplash`, commercialUse: true, requiresAttribution: true },
      downloadTrackingUrl: `${r.links.download_location}&client_id=${this.o.accessKey}`,
    }));
  }
}

/** Openverse images: no key, CC-licensed, filtered to commercial-use licenses. */
export class OpenverseStock implements StockProvider {
  readonly id = "openverse";
  readonly kinds: ("image" | "video")[] = ["image"];
  async search(q: Q): Promise<VisualCandidate[]> {
    if (q.kind !== "image") return [];
    const ar = q.orientation === "landscape" ? "&aspect_ratio=wide" : q.orientation === "portrait" ? "&aspect_ratio=tall" : "";
    const j = await requestJson<{ results?: { id: string; url: string; thumbnail?: string; width?: number; height?: number; title?: string; creator?: string; license: string; license_version?: string; foreign_landing_url?: string; attribution?: string }[] }>(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q.query)}&license_type=commercial&page_size=${q.limit ?? 8}${ar}&mature=false`,
      { provider: this.id, rateKey: "openverse", ratePerMinute: 20, signal: q.signal, retry: { retries: 1, timeoutMs: 20_000 } },
    );
    return (j.results ?? []).map((r) => ({
      id: `openverse-${r.id}`,
      kind: "image",
      url: r.url,
      previewUrl: r.thumbnail,
      width: r.width,
      height: r.height,
      description: r.title,
      provider: this.id,
      license: { name: `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim(), url: r.foreign_landing_url, attribution: r.attribution ?? `${r.title} by ${r.creator}`, commercialUse: true, requiresAttribution: !["cc0", "pdm"].includes(r.license) },
    }));
  }
}

/** Wikimedia Commons: great for documents, historic photos and standards pages; license varies per file. */
export class WikimediaStock implements StockProvider {
  readonly id = "wikimedia";
  readonly kinds: ("image" | "video")[] = ["image"];
  constructor(private readonly o: { userAgent?: string } = {}) {}
  async search(q: Q): Promise<VisualCandidate[]> {
    if (q.kind !== "image") return [];
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=${q.limit ?? 8}&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q.query}`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1600`;
    const j = await requestJson<{ query?: { pages?: Record<string, { title: string; imageinfo?: { thumburl?: string; url: string; width: number; height: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> } }>(url, {
      provider: this.id,
      headers: { "user-agent": this.o.userAgent ?? "vid-skills/0.1 (https://github.com/codewithveek/vid-skills)" },
      signal: q.signal,
      // Wikimedia throttles bursts with empty/HTML bodies: stay well under its anonymous rate.
      rateKey: "wikimedia",
      ratePerMinute: 30,
      retry: { retries: 2, timeoutMs: 20_000 },
    });
    return Object.values(j.query?.pages ?? {}).flatMap((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii) return [];
      const m = ii.extmetadata ?? {};
      const licName = m.LicenseShortName?.value ?? "unknown";
      const nc = /nc|non-?commercial/i.test(licName) || licName === "unknown";
      const pd = /public domain|cc0|pd/i.test(licName);
      const artist = (m.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim();
      return [{ id: `wm-${p.title}`, kind: "image" as const, url: ii.thumburl ?? ii.url, width: ii.width, height: ii.height, description: p.title, provider: this.id, license: { name: licName, url: ii.descriptionurl, attribution: `${artist || "Unknown"}, ${licName}, via Wikimedia Commons`, commercialUse: !nc, requiresAttribution: !pd } }];
    });
  }
}

/* ============================ Image generation ============================ */

function nearestOpenAISize(w: number, h: number): string {
  const r = w / h;
  return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
}

export class OpenAIImages implements ImageProvider {
  readonly id = "openai-images";
  readonly commercialUse = true;
  constructor(private readonly o: { apiKey: string; model?: string; baseUrl?: string; quality?: string }) {}
  async generate(req: ImageGenRequest) {
    const size = nearestOpenAISize(req.width, req.height);
    const j = await requestJson<{ data?: { b64_json?: string }[] }>(`${(this.o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/images/generations`, {
      provider: this.id,
      method: "POST",
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.o.model ?? "gpt-image-1", prompt: req.prompt, size, n: 1, quality: this.o.quality ?? "medium" }),
      signal: req.signal,
      retry: { timeoutMs: 300_000 },
    });
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("openai-images: empty response", this.id, undefined, true);
    const [w, h] = size.split("x").map(Number) as [number, number];
    return { bytes: bytesFromBase64(b64), mime: "image/png", width: w, height: h, license: { name: "OpenAI output (owned by you per terms)", commercialUse: true, requiresAttribution: false } };
  }
}

export class GeminiImages implements ImageProvider {
  readonly id = "imagen";
  readonly commercialUse = true;
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async generate(req: ImageGenRequest) {
    const r = req.width / req.height;
    const aspectRatio = r > 1.5 ? "16:9" : r > 1.15 ? "4:3" : r < 0.6 ? "9:16" : r < 0.87 ? "3:4" : "1:1";
    const j = await requestJson<{ predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] }>(`https://generativelanguage.googleapis.com/v1beta/models/${this.o.model ?? "imagen-4.0-generate-001"}:predict`, {
      provider: this.id,
      method: "POST",
      headers: { "x-goog-api-key": this.o.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ instances: [{ prompt: req.prompt }], parameters: { sampleCount: 1, aspectRatio } }),
      signal: req.signal,
    });
    const p = j.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw new ProviderError("imagen: no image (possibly filtered)", this.id, undefined, false);
    return { bytes: bytesFromBase64(p.bytesBase64Encoded), mime: p.mimeType ?? "image/png", width: req.width, height: req.height, license: { name: "Google generative AI terms (SynthID watermark)", commercialUse: true, requiresAttribution: false } };
  }
}

/** FLUX.1 [schnell] (Apache-2.0) on Workers AI: free tier friendly, ~1 s per image. */
export class WorkersAiImages implements ImageProvider {
  readonly id = "workers-ai-flux";
  readonly commercialUse = true;
  constructor(private readonly o: { model?: string; binding?: AiBinding; accountId?: string; apiToken?: string }) {}
  async generate(req: ImageGenRequest) {
    const out = (await runWorkersAi(this.o, this.o.model ?? "@cf/black-forest-labs/flux-1-schnell", { prompt: req.prompt.slice(0, 2048), steps: 6, ...(req.seed !== undefined ? { seed: req.seed } : {}) }, req.signal)) as { image?: string } | Uint8Array;
    const bytes = out instanceof Uint8Array ? out : out.image ? bytesFromBase64(out.image) : null;
    if (!bytes) throw new ProviderError("workers-ai-flux: empty image", this.id, undefined, true);
    return { bytes, mime: "image/jpeg", width: 1024, height: 1024, license: { name: "Apache-2.0 (FLUX.1 schnell)", commercialUse: true, requiresAttribution: false } };
  }
}

export class HostedImages implements ImageProvider {
  readonly id: string;
  constructor(
    private readonly m: HostedModel,
    readonly commercialUse = true,
  ) {
    this.id = `${m.host}:${m.model}`;
  }
  async generate(req: ImageGenRequest) {
    const aspect = req.width / req.height > 1.2 ? "16:9" : req.width / req.height < 0.8 ? "9:16" : "1:1";
    const { bytes, mime } = await runHosted(this.m, { prompt: req.prompt, width: req.width, height: req.height, aspect }, req.signal);
    return { bytes, mime: mime.startsWith("image/") ? mime : "image/png", width: req.width, height: req.height, license: { name: `model license: ${this.m.model}`, commercialUse: this.commercialUse, requiresAttribution: false } };
  }
}

export class FallbackImages implements ImageProvider {
  readonly id: string;
  constructor(private readonly chain: ImageProvider[]) {
    this.id = `fallback(${chain.map((c) => c.id).join(",")})`;
  }
  get commercialUse() {
    return this.chain.every((c) => c.commercialUse);
  }
  async generate(req: ImageGenRequest) {
    const errs: string[] = [];
    for (const p of this.chain) {
      try {
        return await p.generate(req);
      } catch (e) {
        errs.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new ProviderError(`all image providers failed:\n${errs.join("\n")}`, this.id, undefined, true);
  }
}

/* ============================ Video generation ============================ */

/** Any text/image-to-video model on fal or Replicate (Veo, Kling, Runway, Luma, LTX, Wan, Hunyuan…). Clips are short: request ≤ maxDurationSec and loop/extend in the edit. */
export class HostedVideo implements VideoGenProvider {
  readonly id: string;
  constructor(
    private readonly m: HostedModel,
    readonly maxDurationSec = 5,
    private readonly commercialUse = true,
  ) {
    this.id = `${m.host}:${m.model}`;
  }
  async generate(req: VideoGenRequest) {
    const d = Math.min(this.maxDurationSec, Math.max(1, Math.round(req.durationSec)));
    const { bytes, mime } = await runHosted({ ...this.m, outputExt: this.m.outputExt ?? ["mp4", "webm", "mov"] }, { prompt: req.prompt, duration: d, aspect: req.aspect, image_url: req.imageUrl }, req.signal);
    return { bytes, mime: mime.startsWith("video/") ? mime : "video/mp4", durationSec: d, license: { name: `model license: ${this.m.model}`, commercialUse: this.commercialUse, requiresAttribution: false } };
  }
}
