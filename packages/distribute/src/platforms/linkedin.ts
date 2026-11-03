/**
 * LinkedIn Videos API + Posts API (versioned REST).
 * initializeUpload → PUT each uploadInstruction byte range → finalizeUpload(ETags)
 * → wait AVAILABLE → create post. Commentary is escaped for "little text format".
 */
import { ProviderError, poll, request, requestJson } from "@vid-skills/providers";
import { adaptCopy } from "../copy.js";
import type { PlatformPublisher, PublishInput, PublishOutput } from "../types.js";

export class LinkedInPublisher implements PlatformPublisher {
  readonly platform = "linkedin" as const;
  constructor(private readonly o: { token: () => Promise<string>; author: string; version?: string }) {}
  validate(i: PublishInput): string[] {
    const w: string[] = [];
    if (!/^urn:li:(person|organization):/.test(this.o.author)) w.push("LinkedIn author must be urn:li:person:… or urn:li:organization:…");
    if (i.video.durationSec && (i.video.durationSec < 3 || i.video.durationSec > 1800)) w.push("LinkedIn: 3 s – 30 min");
    return w;
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const h = { authorization: `Bearer ${token}`, "LinkedIn-Version": this.o.version ?? "202510", "X-Restli-Protocol-Version": "2.0.0", "content-type": "application/json" };
    const init = await requestJson<{ value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] } }>("https://api.linkedin.com/rest/videos?action=initializeUpload", {
      provider: "linkedin",
      method: "POST",
      headers: h,
      body: JSON.stringify({ initializeUploadRequest: { owner: this.o.author, fileSizeBytes: i.video.size, uploadCaptions: false, uploadThumbnail: false } }),
      signal: i.signal,
    });
    const etags: string[] = [];
    for (const part of init.value.uploadInstructions) {
      const bytes = await i.video.read(part.firstByte, part.lastByte - part.firstByte + 1);
      const res = await request(part.uploadUrl, { provider: "linkedin", method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: bytes as BodyInit, signal: i.signal, retry: { retries: 3, timeoutMs: 600_000 } });
      const et = res.headers.get("etag");
      if (!et) throw new ProviderError("linkedin: part upload returned no ETag", "linkedin", res.status, false);
      etags.push(et);
    }
    await request("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
      provider: "linkedin",
      method: "POST",
      headers: h,
      body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? "", uploadedPartIds: etags } }),
      signal: i.signal,
    });
    await poll(
      async () => {
        const s = await requestJson<{ status?: string }>(`https://api.linkedin.com/rest/videos/${encodeURIComponent(init.value.video)}`, { provider: "linkedin", headers: h, signal: i.signal });
        if (s.status === "AVAILABLE") return true;
        if (s.status === "PROCESSING_FAILED") throw new ProviderError("linkedin: video processing failed", "linkedin", undefined, false);
        return null;
      },
      { provider: "linkedin", signal: i.signal, intervalMs: 4000, timeoutMs: 15 * 60_000 },
    );
    const res = await request("https://api.linkedin.com/rest/posts", {
      provider: "linkedin",
      method: "POST",
      headers: h,
      body: JSON.stringify({
        author: this.o.author,
        commentary: adaptCopy("linkedin", i.copy).text,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { title: i.copy.title.slice(0, 200), id: init.value.video } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
      signal: i.signal,
    });
    const urn = res.headers.get("x-restli-id") ?? undefined;
    return { platform: "linkedin", status: "published", remoteId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}` : undefined };
  }
}
