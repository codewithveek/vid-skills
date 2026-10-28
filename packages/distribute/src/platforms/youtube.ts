/**
 * YouTube Data API v3 resumable upload (works for Shorts: vertical ≤ 3 min is
 * classified automatically). Chunked in 256 KiB multiples, resumes after
 * interruptions by querying the received range, uploads SRT captions and an
 * optional thumbnail, and sets the synthetic-media disclosure.
 */
import { ProviderError, request, requestJson } from "@vid-skills/providers";
import { platformSpec } from "@vid-skills/core";
import { adaptCopy } from "../copy.js";
import type { PlatformPublisher, PublishInput, PublishOutput } from "../types.js";

export interface YouTubeOptions {
  token: () => Promise<string>;
  privacy?: "public" | "unlisted" | "private";
  categoryId?: string;
  shorts?: boolean;
  chunkBytes?: number;
}

const CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB

export class YouTubePublisher implements PlatformPublisher {
  readonly platform;
  constructor(private readonly o: YouTubeOptions) {
    this.platform = o.shorts === false ? ("youtube" as const) : ("youtube_shorts" as const);
  }
  validate(i: PublishInput): string[] {
    const s = platformSpec(this.platform);
    const w: string[] = [];
    if (i.video.durationSec && i.video.durationSec > s.maxSec) w.push(`${s.label}: ${i.video.durationSec}s exceeds ${s.maxSec}s`);
    if (this.platform === "youtube_shorts" && i.video.width && i.video.height && i.video.width > i.video.height) w.push("Shorts should be vertical or square");
    return w;
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const text = adaptCopy(this.platform, i.copy);
    const meta = {
      snippet: { title: text.title, description: text.text, tags: text.tags, categoryId: this.o.categoryId ?? "27", defaultLanguage: "en" },
      status: { privacyStatus: (i.options?.privacy as string) ?? this.o.privacy ?? "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: i.aiGenerated ?? true },
    };
    const init = await request("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      provider: "youtube",
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(i.video.size), "x-upload-content-type": i.video.mime },
      body: JSON.stringify(meta),
      signal: i.signal,
    });
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new ProviderError("youtube: no resumable session URL", "youtube", init.status, false);
    const chunk = this.o.chunkBytes ?? CHUNK;
    let offset = 0;
    let video: { id?: string } | null = null;
    let stalls = 0;
    while (!video) {
      const len = Math.min(chunk, i.video.size - offset);
      const bytes = await i.video.read(offset, len);
      let res: Response;
      try {
        res = await fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-length": String(len), "content-range": `bytes ${offset}-${offset + len - 1}/${i.video.size}` }, body: bytes as BodyInit, signal: i.signal });
      } catch (e) {
        if (++stalls > 5) throw e;
        offset = await this.resumeOffset(uploadUrl, token, i.video.size);
        continue;
      }
      if (res.status === 308) {
        const range = res.headers.get("range");
        offset = range ? Number(range.split("-")[1]) + 1 : offset + len;
        stalls = 0;
      } else if (res.ok) {
        video = (await res.json()) as { id?: string };
      } else if (res.status >= 500 && ++stalls <= 5) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** stalls));
        offset = await this.resumeOffset(uploadUrl, token, i.video.size);
      } else {
        throw new ProviderError(`youtube upload: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`, "youtube", res.status, false);
      }
    }
    const id = video.id!;
    const warnings: string[] = [];
    if (i.captionsSrt) {
      try {
        await this.uploadCaptions(id, i.captionsSrt, token);
      } catch (e) {
        warnings.push(`captions: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (i.thumbnail) {
      try {
        await request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${id}`, { provider: "youtube", method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": i.thumbnail.mime }, body: i.thumbnail.bytes as BodyInit });
      } catch (e) {
        warnings.push(`thumbnail (requires a verified channel): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (meta.status.privacyStatus !== "private" && !warnings.length) {
      /* Unverified API projects are forced to private regardless of request; surface it. */
      try {
        const v = await requestJson<{ items?: { status?: { privacyStatus?: string; uploadStatus?: string } }[] }>(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${id}`, { provider: "youtube", headers: { authorization: `Bearer ${token}` } });
        if (v.items?.[0]?.status?.privacyStatus === "private") warnings.push("YouTube set the video to private: the API project is likely unaudited (request an audit to publish publicly).");
      } catch {
        /* non-fatal */
      }
    }
    const url = this.platform === "youtube_shorts" ? `https://youtube.com/shorts/${id}` : `https://youtu.be/${id}`;
    return { platform: this.platform, status: "published", remoteId: id, url, warnings };
  }
  private async resumeOffset(uploadUrl: string, token: string, size: number): Promise<number> {
    const res = await fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-range": `bytes */${size}`, "content-length": "0" } });
    if (res.status === 308) {
      const range = res.headers.get("range");
      return range ? Number(range.split("-")[1]) + 1 : 0;
    }
    return 0;
  }
  private async uploadCaptions(videoId: string, srt: string, token: string): Promise<void> {
    const boundary = `vidsk${Date.now().toString(36)}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ snippet: { videoId, language: "en", name: "English", isDraft: false } })}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--`;
    await request("https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart", { provider: "youtube", method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body });
  }
}
