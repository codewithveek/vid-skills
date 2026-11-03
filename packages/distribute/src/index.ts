/**
 * Plug-and-play distribution. `publishersFromEnv` wires every platform that has
 * credentials; `createPublisher` adapts them to the pipeline's `Publisher` hook.
 */
import type { Platform, Publisher, PublishResult } from "@vid-skills/core";
import { accessToken, MemoryTokenStore, refreshThreadsToken, type OAuthApp, type TokenStore } from "./auth.js";
import { YouTubePublisher } from "./platforms/youtube.js";
import { TikTokPublisher } from "./platforms/tiktok.js";
import { FacebookReelsPublisher, InstagramPublisher, ThreadsPublisher } from "./platforms/meta.js";
import { XPublisher } from "./platforms/x.js";
import { LinkedInPublisher } from "./platforms/linkedin.js";
import { BlueskyPublisher, PinterestPublisher, WebhookPublisher } from "./platforms/other.js";
import { storageSource, type PlatformPublisher, type PublishInput, type PublishOutput } from "./types.js";

export * from "./types.js";
export * from "./auth.js";
export * from "./copy.js";
export { YouTubePublisher, TikTokPublisher, InstagramPublisher, FacebookReelsPublisher, ThreadsPublisher, XPublisher, LinkedInPublisher, PinterestPublisher, BlueskyPublisher, WebhookPublisher };
export { tiktokChunks } from "./platforms/tiktok.js";

type Env = Record<string, string | undefined>;

/**
 * Seeds the token store from env on first use (so a refresh token pasted into a
 * secret works), then always reads the store (so rotated tokens survive).
 */
async function seed(store: TokenStore, key: string, env: Env, access?: string, refresh?: string, expiresIn = 0): Promise<void> {
  if (await store.get(key)) return;
  const a = access ? env[access] : undefined;
  const r = refresh ? env[refresh] : undefined;
  if (!a && !r) return;
  await store.set(key, { accessToken: a ?? "", refreshToken: r, expiresAt: a ? (expiresIn ? Date.now() + expiresIn : undefined) : 0 });
}

function tokenFn(store: TokenStore, key: string, platform: Parameters<typeof accessToken>[2], app?: OAuthApp) {
  return async () => (await accessToken(store, key, platform, app)).accessToken;
}

export function publishersFromEnv(env: Env, store: TokenStore = new MemoryTokenStore(), stored: Set<string> = new Set()): { publishers: Map<Platform, PlatformPublisher>; webhook?: WebhookPublisher; ready: Promise<void> } {
  const m = new Map<Platform, PlatformPublisher>();
  const seeds: Promise<void>[] = [];
  const graphVersion = env.META_GRAPH_VERSION;

  if (env.YOUTUBE_REFRESH_TOKEN || env.YOUTUBE_ACCESS_TOKEN || stored.has("youtube")) {
    seeds.push(seed(store, "youtube", env, "YOUTUBE_ACCESS_TOKEN", "YOUTUBE_REFRESH_TOKEN"));
    const app = env.YOUTUBE_CLIENT_ID ? { clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET } : undefined;
    const token = tokenFn(store, "youtube", "youtube", app);
    const privacy = (env.YOUTUBE_PRIVACY as "public" | "unlisted" | "private" | undefined) ?? "public";
    m.set("youtube_shorts", new YouTubePublisher({ token, privacy, shorts: true }));
    m.set("youtube", new YouTubePublisher({ token, privacy, shorts: false }));
  }
  if (env.TIKTOK_REFRESH_TOKEN || env.TIKTOK_ACCESS_TOKEN || stored.has("tiktok")) {
    seeds.push(seed(store, "tiktok", env, "TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN"));
    const app = env.TIKTOK_CLIENT_KEY ? { clientId: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET } : undefined;
    m.set("tiktok", new TikTokPublisher({ token: tokenFn(store, "tiktok", "tiktok", app), mode: (env.TIKTOK_MODE as "direct" | "inbox") ?? "direct", privacy: env.TIKTOK_PRIVACY as never }));
  }
  if (env.INSTAGRAM_USER_ID && (env.INSTAGRAM_ACCESS_TOKEN || stored.has("instagram"))) {
    seeds.push(seed(store, "instagram", env, "INSTAGRAM_ACCESS_TOKEN"));
    m.set("instagram_reels", new InstagramPublisher({ igUserId: env.INSTAGRAM_USER_ID, token: tokenFn(store, "instagram", "meta"), version: graphVersion, graphHost: env.INSTAGRAM_GRAPH_HOST }));
  }
  if (env.FACEBOOK_PAGE_ID && (env.FACEBOOK_PAGE_TOKEN || stored.has("facebook"))) {
    seeds.push(seed(store, "facebook", env, "FACEBOOK_PAGE_TOKEN"));
    m.set("facebook_reels", new FacebookReelsPublisher({ pageId: env.FACEBOOK_PAGE_ID, token: tokenFn(store, "facebook", "meta"), version: graphVersion }));
  }
  if (env.THREADS_USER_ID && (env.THREADS_ACCESS_TOKEN || stored.has("threads"))) {
    seeds.push(seed(store, "threads", env, "THREADS_ACCESS_TOKEN", undefined, 50 * 86_400_000));
    m.set("threads", new ThreadsPublisher({ userId: env.THREADS_USER_ID, token: async () => (await refreshThreadsToken(store, "threads")).accessToken }));
  }
  if (env.X_REFRESH_TOKEN || env.X_ACCESS_TOKEN || stored.has("x")) {
    seeds.push(seed(store, "x", env, "X_ACCESS_TOKEN", "X_REFRESH_TOKEN"));
    const app = env.X_CLIENT_ID ? { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET } : undefined;
    m.set("x", new XPublisher({ token: tokenFn(store, "x", "x", app) }));
  }
  if ((env.LINKEDIN_ACCESS_TOKEN || env.LINKEDIN_REFRESH_TOKEN || stored.has("linkedin")) && env.LINKEDIN_AUTHOR_URN) {
    seeds.push(seed(store, "linkedin", env, "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_REFRESH_TOKEN"));
    const app = env.LINKEDIN_CLIENT_ID ? { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET } : undefined;
    m.set("linkedin", new LinkedInPublisher({ token: tokenFn(store, "linkedin", "linkedin", app), author: env.LINKEDIN_AUTHOR_URN, version: env.LINKEDIN_VERSION }));
  }
  if ((env.PINTEREST_ACCESS_TOKEN || env.PINTEREST_REFRESH_TOKEN || stored.has("pinterest")) && env.PINTEREST_BOARD_ID) {
    seeds.push(seed(store, "pinterest", env, "PINTEREST_ACCESS_TOKEN", "PINTEREST_REFRESH_TOKEN"));
    const app = env.PINTEREST_CLIENT_ID ? { clientId: env.PINTEREST_CLIENT_ID, clientSecret: env.PINTEREST_CLIENT_SECRET } : undefined;
    m.set("pinterest", new PinterestPublisher({ token: tokenFn(store, "pinterest", "pinterest", app), boardId: env.PINTEREST_BOARD_ID, link: env.PINTEREST_LINK }));
  }
  if (env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD) {
    m.set("bluesky", new BlueskyPublisher({ identifier: env.BLUESKY_HANDLE, appPassword: env.BLUESKY_APP_PASSWORD, service: env.BLUESKY_SERVICE }));
  }
  const webhook = env.PUBLISH_WEBHOOK_URL ? new WebhookPublisher({ url: env.PUBLISH_WEBHOOK_URL, secret: env.PUBLISH_WEBHOOK_SECRET }) : undefined;
  return { publishers: m, webhook, ready: Promise.all(seeds).then(() => undefined) };
}

export interface CreatePublisherOptions {
  publishers: Map<Platform, PlatformPublisher>;
  webhook?: WebhookPublisher;
  ready?: Promise<void>;
  /** Called with every result, e.g. to notify Slack/Discord. */
  onResult?: (r: PublishOutput) => void | Promise<void>;
  /** "dry-run" validates and reports without uploading. */
  mode?: "live" | "dry-run";
}

/** Adapts platform publishers to the pipeline's Publisher hook. */
export function createPublisher(o: CreatePublisherOptions): Publisher {
  return async ({ platform, videoKey, captionsKey, copy, storage, brief }): Promise<PublishResult> => {
    await o.ready;
    const pub = o.publishers.get(platform);
    const video = await storageSource(storage, videoKey);
    const captionsSrt = captionsKey ? ((await storage.getText(captionsKey)) ?? undefined) : undefined;
    const input: PublishInput = { video: { ...video, durationSec: video.durationSec ?? brief.durationSec }, copy, captionsSrt, aiGenerated: true };
    if (!pub) {
      if (o.webhook) {
        const r = await o.webhook.publish(input, [platform]);
        return { status: r.ok ? "processing" : "failed", error: r.ok ? undefined : `webhook HTTP ${r.status}` };
      }
      return { status: "skipped", error: `no credentials configured for ${platform}` };
    }
    const issues = pub.validate(input);
    if (issues.length) {
      const out: PublishOutput = { platform, status: "skipped", error: issues.join("; ") };
      await o.onResult?.(out);
      return out;
    }
    if (o.mode === "dry-run") return { status: "skipped", error: "dry-run" };
    try {
      const out = await pub.publish(input);
      await o.onResult?.(out);
      return { status: out.status, remoteId: out.remoteId, url: out.url, error: out.warnings?.length ? out.warnings.join(" ") : undefined };
    } catch (e) {
      const out: PublishOutput = { platform, status: "failed", error: e instanceof Error ? e.message : String(e) };
      await o.onResult?.(out);
      return out;
    }
  };
}
