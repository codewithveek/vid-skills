/**
 * Meta platforms: Instagram Reels, Facebook Page Reels and Threads.
 *  - Instagram: resumable rupload (no public URL needed) or video_url; poll status_code; media_publish.
 *    Checks content_publishing_limit first so a capped account fails fast with a clear reason.
 *  - Facebook: video_reels start → rupload → finish(video_state=PUBLISHED).
 *  - Threads: requires a public video URL; container → poll → threads_publish.
 */
import { ProviderError, poll, request, requestJson } from "@vid-skills/providers";
import { adaptCopy } from "../copy.js";
import { readAll, type PlatformPublisher, type PublishInput, type PublishOutput } from "../types.js";

export interface MetaCommon {
  token: () => Promise<string>;
  version?: string; // Graph API version, e.g. v24.0
}

const v = (o: MetaCommon) => o.version ?? "v24.0";

async function rupload(url: string, token: string, i: PublishInput): Promise<void> {
  // rupload accepts the whole body with an offset header; resend from the server's offset on failure.
  const bytes = await readAll(i.video);
  await request(url, {
    provider: "meta-rupload",
    method: "POST",
    headers: { authorization: `OAuth ${token}`, offset: "0", file_size: String(i.video.size), "content-type": "application/octet-stream" },
    body: bytes as BodyInit,
    signal: i.signal,
    retry: { retries: 3, timeoutMs: 900_000 },
  });
}

export class InstagramPublisher implements PlatformPublisher {
  readonly platform = "instagram_reels" as const;
  constructor(private readonly o: MetaCommon & { igUserId: string; graphHost?: string; shareToFeed?: boolean }) {}
  validate(i: PublishInput): string[] {
    const w: string[] = [];
    if (i.video.durationSec && (i.video.durationSec < 3 || i.video.durationSec > 900)) w.push("Instagram Reels: 3 s – 15 min");
    return w;
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const host = this.o.graphHost ?? "https://graph.facebook.com";
    const base = `${host}/${v(this.o)}`;
    const auth = { authorization: `Bearer ${token}` };
    try {
      const lim = await requestJson<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(`${base}/${this.o.igUserId}/content_publishing_limit?fields=quota_usage,config`, { provider: "instagram", headers: auth });
      const d = lim.data?.[0];
      if (d?.config?.quota_total && (d.quota_usage ?? 0) >= d.config.quota_total) throw new ProviderError(`instagram: publishing limit reached (${d.quota_usage}/${d.config.quota_total} in 24 h)`, "instagram", 429, true);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 429) throw e;
    }
    const caption = adaptCopy("instagram_reels", i.copy).text;
    const params = new URLSearchParams({ media_type: "REELS", caption, share_to_feed: String(this.o.shareToFeed ?? true) });
    let container: { id: string; uri?: string };
    if (i.video.publicUrl) {
      params.set("video_url", i.video.publicUrl);
      container = await requestJson(`${base}/${this.o.igUserId}/media?${params}`, { provider: "instagram", method: "POST", headers: auth, signal: i.signal });
    } else {
      params.set("upload_type", "resumable");
      container = await requestJson(`${base}/${this.o.igUserId}/media?${params}`, { provider: "instagram", method: "POST", headers: auth, signal: i.signal });
      await rupload(container.uri ?? `https://rupload.facebook.com/ig-api-upload/${v(this.o)}/${container.id}`, token, i);
    }
    await poll(
      async () => {
        const s = await requestJson<{ status_code?: string; status?: string }>(`${base}/${container.id}?fields=status_code,status`, { provider: "instagram", headers: auth, signal: i.signal });
        if (s.status_code === "FINISHED") return true;
        if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new ProviderError(`instagram container ${s.status_code}: ${s.status ?? ""}`, "instagram", undefined, false);
        return null;
      },
      { provider: "instagram", signal: i.signal, intervalMs: 5000, timeoutMs: 20 * 60_000 },
    );
    const pub = await requestJson<{ id: string }>(`${base}/${this.o.igUserId}/media_publish?creation_id=${container.id}`, { provider: "instagram", method: "POST", headers: auth, signal: i.signal });
    let url: string | undefined;
    try {
      url = (await requestJson<{ permalink?: string }>(`${base}/${pub.id}?fields=permalink`, { provider: "instagram", headers: auth })).permalink;
    } catch {
      /* optional */
    }
    return { platform: this.platform, status: "published", remoteId: pub.id, url };
  }
}

export class FacebookReelsPublisher implements PlatformPublisher {
  readonly platform = "facebook_reels" as const;
  constructor(private readonly o: MetaCommon & { pageId: string }) {}
  validate(i: PublishInput): string[] {
    return i.video.durationSec && i.video.durationSec > 90 ? ["Facebook Reels: ≤ 90 s (post longer videos as Page videos)"] : [];
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    const token = await this.o.token();
    const base = `https://graph.facebook.com/${v(this.o)}/${this.o.pageId}/video_reels`;
    const start = await requestJson<{ video_id: string; upload_url: string }>(`${base}?upload_phase=start&access_token=${encodeURIComponent(token)}`, { provider: "facebook", method: "POST", signal: i.signal });
    if (i.video.publicUrl) {
      await request(start.upload_url, { provider: "facebook", method: "POST", headers: { authorization: `OAuth ${token}`, file_url: i.video.publicUrl }, signal: i.signal });
    } else {
      await rupload(start.upload_url, token, i);
    }
    const description = adaptCopy("facebook_reels", i.copy).text;
    await requestJson(`${base}?upload_phase=finish&video_id=${start.video_id}&video_state=PUBLISHED&description=${encodeURIComponent(description)}&access_token=${encodeURIComponent(token)}`, { provider: "facebook", method: "POST", signal: i.signal });
    return { platform: this.platform, status: "processing", remoteId: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
  }
}

export class ThreadsPublisher implements PlatformPublisher {
  readonly platform = "threads" as const;
  constructor(private readonly o: MetaCommon & { userId: string }) {}
  validate(i: PublishInput): string[] {
    return i.video.publicUrl ? [] : ["Threads needs a public HTTPS video URL (configure R2 public access or signed URLs)"];
  }
  async publish(i: PublishInput): Promise<PublishOutput> {
    if (!i.video.publicUrl) return { platform: this.platform, status: "skipped", error: "no public video URL" };
    const token = await this.o.token();
    const base = `https://graph.threads.net/v1.0`;
    const text = adaptCopy("threads", i.copy).text;
    const c = await requestJson<{ id: string }>(`${base}/${this.o.userId}/threads?media_type=VIDEO&video_url=${encodeURIComponent(i.video.publicUrl)}&text=${encodeURIComponent(text)}&access_token=${encodeURIComponent(token)}`, { provider: "threads", method: "POST", signal: i.signal });
    await poll(
      async () => {
        const s = await requestJson<{ status?: string; error_message?: string }>(`${base}/${c.id}?fields=status,error_message&access_token=${encodeURIComponent(token)}`, { provider: "threads", signal: i.signal });
        if (s.status === "FINISHED") return true;
        if (s.status === "ERROR" || s.status === "EXPIRED") throw new ProviderError(`threads: ${s.error_message ?? s.status}`, "threads", undefined, false);
        return null;
      },
      { provider: "threads", signal: i.signal, intervalMs: 5000, timeoutMs: 15 * 60_000 },
    );
    const p = await requestJson<{ id: string }>(`${base}/${this.o.userId}/threads_publish?creation_id=${c.id}&access_token=${encodeURIComponent(token)}`, { provider: "threads", method: "POST", signal: i.signal });
    return { platform: this.platform, status: "published", remoteId: p.id };
  }
}
