/**
 * TikTok Content Posting API.
 *  - direct: creator_info → video/init (FILE_UPLOAD or PULL_FROM_URL) → chunked PUT → status/fetch
 *  - inbox:  uploads as a draft to the creator's inbox (scope video.upload) for manual finishing
 * Workarounds: chunk math within 5–64 MB (final ≤ 128 MB, ≤ 1000 chunks), privacy level
 * negotiated from creator_info (unaudited apps can only post SELF_ONLY), 6 init/min limit.
 */
import { ProviderError, poll, request, requestJson } from "@vid-skills/providers";
import { adaptCopy } from "../copy.js";
import type { PlatformPublisher, PublishInput, PublishOutput } from "../types.js";

const API = "https://open.tiktokapis.com/v2";
const MB = 1024 * 1024;

export function tiktokChunks(size: number, preferred = 10 * MB): { chunkSize: number; total: number } {
  if (size < 5 * MB) return { chunkSize: size, total: 1 };
  let chunk = Math.min(64 * MB, Math.max(5 * MB, preferred));
  let total = Math.floor(size / chunk);
  while (total > 1000) {
    chunk = Math.min(64 * MB, chunk * 2);
    total = Math.floor(size / chunk);
  }
  return { chunkSize: chunk, total: Math.max(1, total) };
}

export interface TikTokOptions {
  token: () => Promise<string>;
  mode?: "direct" | "inbox";
  privacy?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
  usePullFromUrl?: boolean;
}

interface TTResp<T> {
  data: T;
  error: { code: string; message: string; log_id?: string };
}

export class TikTokPublisher implements PlatformPublisher {
  readonly platform = "tiktok" as const;
  constructor(private readonly o: TikTokOptions) {}
  validate(i: PublishInput): string[] {
    const w: string[] = [];
    if (i.video.size > 4 * 1024 * MB) w.push("TikTok: file exceeds 4 GB");
    if (i.video.durationSec && i.video.durationSec < 3) w.push("TikTok: video shorter than 3 s");
    return w;
  }
  private async call<T>(path: string, token: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const j = await requestJson<TTResp<T>>(`${API}${path}`, { provider: "tiktok", method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body), signal, rateKey: path.includes("init") ? "tiktok-init" : undefined, ratePerMinute: path.includes("init") ? 6 : undefined });
    if (j.error && j.error.code !== "ok") throw new ProviderError(`tiktok ${path}: ${j.error.code} ${j.error.message}`, "tiktok", 400, j.error.code === "rate_limit_exceeded");
    return j.data;
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const warnings: string[] = [];
    const mode = (i.options?.mode as string) ?? this.o.mode ?? "direct";
    const text = adaptCopy("tiktok", i.copy).text;
    const pull = (this.o.usePullFromUrl || i.options?.pullFromUrl) && i.video.publicUrl;
    const { chunkSize, total } = tiktokChunks(i.video.size);
    const source_info = pull ? { source: "PULL_FROM_URL", video_url: i.video.publicUrl } : { source: "FILE_UPLOAD", video_size: i.video.size, chunk_size: chunkSize, total_chunk_count: total };

    let init: { publish_id: string; upload_url?: string };
    if (mode === "inbox") {
      init = await this.call("/post/publish/inbox/video/init/", token, { source_info }, i.signal);
    } else {
      const info = await this.call<{ privacy_level_options: string[]; max_video_post_duration_sec?: number; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }>("/post/publish/creator_info/query/", token, {}, i.signal);
      if (info.max_video_post_duration_sec && i.video.durationSec && i.video.durationSec > info.max_video_post_duration_sec)
        throw new ProviderError(`tiktok: video ${i.video.durationSec}s exceeds this creator's ${info.max_video_post_duration_sec}s limit`, "tiktok", 400, false);
      const want = (i.options?.privacy as string) ?? this.o.privacy ?? "PUBLIC_TO_EVERYONE";
      const privacy = info.privacy_level_options.includes(want) ? want : (info.privacy_level_options[info.privacy_level_options.length - 1] ?? "SELF_ONLY");
      if (privacy !== want) warnings.push(`TikTok privacy "${want}" not allowed for this creator/app; used ${privacy} (unaudited apps are limited to SELF_ONLY).`);
      init = await this.call("/post/publish/video/init/", token, {
        post_info: {
          title: text,
          privacy_level: privacy,
          disable_comment: !!info.comment_disabled,
          disable_duet: !!info.duet_disabled,
          disable_stitch: !!info.stitch_disabled,
          video_cover_timestamp_ms: Number(i.options?.coverMs ?? 500),
          is_aigc: i.aiGenerated ?? true,
        },
        source_info,
      }, i.signal);
    }
    if (!pull) {
      if (!init.upload_url) throw new ProviderError("tiktok: no upload_url", "tiktok", undefined, false);
      for (let k = 0; k < total; k++) {
        const start = k * chunkSize;
        const end = k === total - 1 ? i.video.size - 1 : start + chunkSize - 1;
        const bytes = await i.video.read(start, end - start + 1);
        await request(init.upload_url, {
          provider: "tiktok",
          method: "PUT",
          headers: { "content-type": i.video.mime, "content-length": String(bytes.length), "content-range": `bytes ${start}-${end}/${i.video.size}` },
          body: bytes as BodyInit,
          signal: i.signal,
          retry: { retries: 3, timeoutMs: 600_000 },
        });
      }
    }
    const done = await poll(
      async () => {
        const s = await this.call<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>("/post/publish/status/fetch/", token, { publish_id: init.publish_id }, i.signal);
        if (s.status === "FAILED") throw new ProviderError(`tiktok publish failed: ${s.fail_reason}`, "tiktok", undefined, false);
        if (s.status === "PUBLISH_COMPLETE" || s.status === "SEND_TO_USER_INBOX") return s;
        return null;
      },
      { provider: "tiktok", signal: i.signal, intervalMs: 3000, timeoutMs: 15 * 60_000 },
    );
    const postId = done.publicaly_available_post_id?.[0];
    return {
      platform: "tiktok",
      status: done.status === "SEND_TO_USER_INBOX" ? "processing" : "published",
      remoteId: postId ? String(postId) : init.publish_id,
      url: postId ? `https://www.tiktok.com/video/${postId}` : undefined,
      warnings: done.status === "SEND_TO_USER_INBOX" ? [...warnings, "Sent to the creator's TikTok inbox; finish posting in the app."] : warnings,
    };
  }
}
