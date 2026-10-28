/**
 * X (Twitter) v2: /2/media/upload/initialize → /{id}/append (≤ 4 MB segments)
 * → /{id}/finalize → STATUS polling → POST /2/tweets with the media id.
 */
import { ProviderError, poll, request, requestJson } from "@vid-skills/providers";
import { adaptCopy } from "../copy.js";
import type { PlatformPublisher, PublishInput, PublishOutput } from "../types.js";

const API = "https://api.x.com/2";

export class XPublisher implements PlatformPublisher {
  readonly platform = "x" as const;
  constructor(private readonly o: { token: () => Promise<string>; segmentBytes?: number }) {}
  validate(i: PublishInput): string[] {
    return i.video.durationSec && i.video.durationSec > 1200 ? ["X: > 20 min requires Premium"] : [];
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const auth = { authorization: `Bearer ${token}` };
    const init = await requestJson<{ data?: { id: string } }>(`${API}/media/upload/initialize`, {
      provider: "x",
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ media_type: i.video.mime, total_bytes: i.video.size, media_category: "tweet_video" }),
      signal: i.signal,
    });
    const id = init.data?.id;
    if (!id) throw new ProviderError("x: initialize returned no media id", "x", undefined, false);
    const seg = this.o.segmentBytes ?? 4 * 1024 * 1024;
    for (let k = 0, off = 0; off < i.video.size; k++, off += seg) {
      const bytes = await i.video.read(off, Math.min(seg, i.video.size - off));
      const fd = new FormData();
      fd.set("segment_index", String(k));
      fd.set("media", new Blob([bytes as BlobPart], { type: "application/octet-stream" }), "chunk");
      await request(`${API}/media/upload/${id}/append`, { provider: "x", method: "POST", headers: auth, body: fd, signal: i.signal, retry: { retries: 4, timeoutMs: 300_000 } });
    }
    const fin = await requestJson<{ data?: { processing_info?: { state: string; check_after_secs?: number } } }>(`${API}/media/upload/${id}/finalize`, { provider: "x", method: "POST", headers: auth, signal: i.signal });
    if (fin.data?.processing_info && fin.data.processing_info.state !== "succeeded") {
      await poll(
        async () => {
          const s = await requestJson<{ data?: { processing_info?: { state: string; error?: { message?: string } } } }>(`${API}/media/upload?command=STATUS&media_id=${id}`, { provider: "x", headers: auth, signal: i.signal });
          const st = s.data?.processing_info?.state;
          if (!st || st === "succeeded") return true;
          if (st === "failed") throw new ProviderError(`x media processing failed: ${s.data?.processing_info?.error?.message ?? ""}`, "x", undefined, false);
          return null;
        },
        { provider: "x", signal: i.signal, intervalMs: 3000, timeoutMs: 15 * 60_000 },
      );
    }
    const tw = await requestJson<{ data?: { id: string } }>(`${API}/tweets`, {
      provider: "x",
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ text: adaptCopy("x", i.copy).text, media: { media_ids: [id] } }),
      signal: i.signal,
    });
    const tid = tw.data?.id;
    return { platform: "x", status: "published", remoteId: tid, url: tid ? `https://x.com/i/status/${tid}` : undefined };
  }
}
