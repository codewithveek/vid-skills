/** Pinterest, Bluesky and generic webhook publishers. */
import { ProviderError, poll, request, requestJson } from "@vid-skills/providers";
import { adaptCopy } from "../copy.js";
import { readAll, type PlatformPublisher, type PublishInput, type PublishOutput } from "../types.js";

/* ---------------------------- Pinterest ---------------------------- */

export class PinterestPublisher implements PlatformPublisher {
  readonly platform = "pinterest" as const;
  constructor(private readonly o: { token: () => Promise<string>; boardId: string; link?: string }) {}
  validate(i: PublishInput): string[] {
    return i.video.durationSec && (i.video.durationSec < 4 || i.video.durationSec > 900) ? ["Pinterest: 4 s – 15 min"] : [];
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const auth = { authorization: `Bearer ${token}` };
    const reg = await requestJson<{ media_id: string; upload_url: string; upload_parameters: Record<string, string> }>("https://api.pinterest.com/v5/media", { provider: "pinterest", method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ media_type: "video" }), signal: i.signal });
    const fd = new FormData();
    for (const [k, val] of Object.entries(reg.upload_parameters)) fd.set(k, val);
    fd.set("file", new Blob([(await readAll(i.video)) as BlobPart], { type: i.video.mime }), i.video.name ?? "video.mp4");
    await request(reg.upload_url, { provider: "pinterest", method: "POST", body: fd, signal: i.signal, retry: { retries: 2, timeoutMs: 900_000 } });
    await poll(
      async () => {
        const s = await requestJson<{ status?: string }>(`https://api.pinterest.com/v5/media/${reg.media_id}`, { provider: "pinterest", headers: auth, signal: i.signal });
        if (s.status === "succeeded") return true;
        if (s.status === "failed") throw new ProviderError("pinterest: media processing failed", "pinterest", undefined, false);
        return null;
      },
      { provider: "pinterest", signal: i.signal, intervalMs: 4000 },
    );
    const t = adaptCopy("pinterest", i.copy);
    const pin = await requestJson<{ id: string }>("https://api.pinterest.com/v5/pins", {
      provider: "pinterest",
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ board_id: (i.options?.boardId as string) ?? this.o.boardId, title: t.title, description: t.text, link: this.o.link, alt_text: i.copy.altText?.slice(0, 500), media_source: { source_type: "video_id", media_id: reg.media_id, cover_image_key_frame_time: 0.5 } }),
      signal: i.signal,
    });
    return { platform: "pinterest", status: "published", remoteId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  }
}

/* ---------------------------- Bluesky ---------------------------- */

function hashtagFacets(text: string): unknown[] {
  const enc = new TextEncoder();
  const facets: unknown[] = [];
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const before = text.slice(0, m.index! + m[1]!.length);
    const start = enc.encode(before).length;
    const end = start + enc.encode(`#${m[2]}`).length;
    facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }] });
  }
  return facets;
}

export class BlueskyPublisher implements PlatformPublisher {
  readonly platform = "bluesky" as const;
  constructor(private readonly o: { identifier: string; appPassword: string; service?: string; videoService?: string }) {}
  validate(i: PublishInput): string[] {
    const w: string[] = [];
    if (i.video.size > 100 * 1024 * 1024) w.push("Bluesky: video > 100 MB");
    if (i.video.durationSec && i.video.durationSec > 180) w.push("Bluesky: video > 3 min");
    return w;
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const svc = this.o.service ?? "https://bsky.social";
    const s = await requestJson<{ accessJwt: string; did: string; didDoc?: { service?: { id: string; serviceEndpoint: string }[] } }>(`${svc}/xrpc/com.atproto.server.createSession`, {
      provider: "bluesky",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: this.o.identifier, password: this.o.appPassword }),
    });
    const pds = s.didDoc?.service?.find((x) => x.id.endsWith("atproto_pds"))?.serviceEndpoint ?? svc;
    const aud = `did:web:${new URL(pds).host}`;
    const sa = await requestJson<{ token: string }>(`${pds}/xrpc/com.atproto.server.getServiceAuth?aud=${encodeURIComponent(aud)}&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 1800}`, { provider: "bluesky", headers: { authorization: `Bearer ${s.accessJwt}` } });
    const vsvc = this.o.videoService ?? "https://video.bsky.app";
    const up = await requestJson<{ jobId?: string; state?: string; blob?: unknown; jobStatus?: { jobId: string; blob?: unknown } }>(`${vsvc}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(s.did)}&name=${encodeURIComponent(i.video.name ?? "video.mp4")}`, {
      provider: "bluesky",
      method: "POST",
      headers: { authorization: `Bearer ${sa.token}`, "content-type": "video/mp4" },
      body: (await readAll(i.video)) as BodyInit,
      signal: i.signal,
      retry: { retries: 2, timeoutMs: 900_000 },
    });
    const jobId = up.jobId ?? up.jobStatus?.jobId;
    let blob = up.blob ?? up.jobStatus?.blob;
    if (!blob && jobId) {
      blob = await poll(
        async () => {
          const js = await requestJson<{ jobStatus: { state: string; blob?: unknown; error?: string } }>(`${vsvc}/xrpc/app.bsky.video.getJobStatus?jobId=${jobId}`, { provider: "bluesky", headers: { authorization: `Bearer ${s.accessJwt}` } });
          if (js.jobStatus.state === "JOB_STATE_COMPLETED" && js.jobStatus.blob) return js.jobStatus.blob;
          if (js.jobStatus.state === "JOB_STATE_FAILED") throw new ProviderError(`bluesky video: ${js.jobStatus.error}`, "bluesky", undefined, false);
          return null;
        },
        { provider: "bluesky", signal: i.signal, intervalMs: 2000 },
      );
    }
    const text = adaptCopy("bluesky", i.copy).text;
    const rec = await requestJson<{ uri: string }>(`${pds}/xrpc/com.atproto.repo.createRecord`, {
      provider: "bluesky",
      method: "POST",
      headers: { authorization: `Bearer ${s.accessJwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        repo: s.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          facets: hashtagFacets(text),
          createdAt: new Date().toISOString(),
          embed: { $type: "app.bsky.embed.video", video: blob, alt: i.copy.altText ?? i.copy.title, aspectRatio: { width: i.video.width ?? 1080, height: i.video.height ?? 1920 } },
        },
      }),
    });
    const rkey = rec.uri.split("/").pop();
    return { platform: "bluesky", status: "published", remoteId: rec.uri, url: `https://bsky.app/profile/${this.o.identifier}/post/${rkey}` };
  }
}

/* ---------------------------- Webhook ---------------------------- */

/**
 * Hand-off to any automation tool or aggregator (Zapier, Make, n8n, Buffer, Ayrshare,
 * Upload-Post…): POSTs a signed JSON payload with the public video URL and per-platform copy.
 */
export class WebhookPublisher {
  constructor(private readonly o: { url: string; secret?: string }) {}
  async publish(i: PublishInput, platforms: string[]): Promise<{ ok: boolean; status: number }> {
    const payload = JSON.stringify({ video: { url: i.video.publicUrl, size: i.video.size, mime: i.video.mime }, copy: i.copy, perPlatform: Object.fromEntries(platforms.map((p) => [p, adaptCopy(p as never, i.copy)])), captionsSrt: i.captionsSrt, aiGenerated: i.aiGenerated ?? true });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.o.secret) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.o.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
      headers["x-vidsk-signature"] = `sha256=${[...sig].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    }
    const res = await request(this.o.url, { provider: "webhook", method: "POST", headers, body: payload, retry: { retries: 3 } });
    return { ok: res.ok, status: res.status };
  }
}
