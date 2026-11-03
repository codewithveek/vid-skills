/**
 * Platform delivery specs used by QA, copy adaptation and the distribution
 * adapters. Limits change often: every entry records where it came from and when
 * it was checked, and every value can be overridden at runtime (`overridePlatformSpec`).
 */
import type { Platform } from "./spec.js";

export interface PlatformSpec {
  id: Platform;
  label: string;
  minSec: number;
  maxSec: number;
  maxBytes: number;
  aspects: string[];
  recommended: { width: number; height: number; fps: number; videoKbps: number; audioKbps: number; lufs: number };
  text: { titleMax?: number; captionMax: number; hashtagsMax?: number; countUnit: "chars" | "utf16" | "graphemes" };
  /** API-specific gotchas surfaced to agents and docs. */
  notes: string[];
  source: string;
  verifiedAt: string;
}

const VERT = { width: 1080, height: 1920, fps: 30, videoKbps: 12000, audioKbps: 192, lufs: -14 };

const SPECS: Record<Platform, PlatformSpec> = {
  youtube_shorts: {
    id: "youtube_shorts",
    label: "YouTube Shorts",
    minSec: 1,
    maxSec: 180,
    maxBytes: 256 * 2 ** 30,
    aspects: ["9:16", "1:1"],
    recommended: VERT,
    text: { titleMax: 100, captionMax: 5000, hashtagsMax: 15, countUnit: "chars" },
    notes: [
      "Uploads from unverified (un-audited) API projects are forced to private; request an audit to publish publicly.",
      "videos.insert draws from a dedicated upload quota bucket; check the project's quota page, values changed in 2025–2026.",
      "Vertical or square and ≤ 3 min is classified as a Short automatically; #Shorts in title/description is optional.",
      "Captions: upload SRT via captions.insert after the video is processed.",
    ],
    source: "https://developers.google.com/youtube/v3/docs/videos/insert",
    verifiedAt: "2026-10",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    minSec: 1,
    maxSec: 12 * 3600,
    maxBytes: 256 * 2 ** 30,
    aspects: ["16:9", "9:16", "1:1", "4:5"],
    recommended: { width: 1920, height: 1080, fps: 30, videoKbps: 12000, audioKbps: 256, lufs: -14 },
    text: { titleMax: 100, captionMax: 5000, hashtagsMax: 15, countUnit: "chars" },
    notes: ["Unverified channels are limited to 15 minutes per video.", "Same audit/quota constraints as Shorts."],
    source: "https://developers.google.com/youtube/v3/docs/videos/insert",
    verifiedAt: "2026-10",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    minSec: 3,
    maxSec: 600,
    maxBytes: 4 * 2 ** 30,
    aspects: ["9:16"],
    recommended: VERT,
    text: { captionMax: 2200, countUnit: "utf16" },
    notes: [
      "Unaudited apps can only post SELF_ONLY (private); pass the Content Posting API audit for public posts.",
      "Query creator_info first: privacy_level options and max_video_post_duration_sec are per creator.",
      "FILE_UPLOAD chunks: 5–64 MB each (final chunk ≤ 128 MB), ≤ 1000 chunks, sequential; files < 5 MB go in one chunk.",
      "PULL_FROM_URL requires a verified domain/URL prefix and no redirects.",
      "Init endpoint: 6 requests/minute per user token; access tokens expire in 24 h (refresh).",
      "Set is_aigc=true for AI-generated content.",
    ],
    source: "https://developers.tiktok.com/doc/content-posting-api-reference-direct-post",
    verifiedAt: "2026-10",
  },
  instagram_reels: {
    id: "instagram_reels",
    label: "Instagram Reels",
    minSec: 3,
    maxSec: 900,
    maxBytes: 1 * 2 ** 30,
    aspects: ["9:16"],
    recommended: VERT,
    text: { captionMax: 2200, hashtagsMax: 30, countUnit: "chars" },
    notes: [
      "Requires an Instagram professional account and the content_publish permission.",
      "Media must be at a public URL (video_url) or sent via the resumable rupload protocol.",
      "Publishing is rate limited per account per rolling 24 h; check content_publishing_limit before publishing.",
      "Poll the container status_code until FINISHED before media_publish.",
    ],
    source: "https://developers.facebook.com/docs/instagram-platform/content-publishing",
    verifiedAt: "2026-10",
  },
  facebook_reels: {
    id: "facebook_reels",
    label: "Facebook Reels",
    minSec: 3,
    maxSec: 90,
    maxBytes: 1 * 2 ** 30,
    aspects: ["9:16"],
    recommended: VERT,
    text: { captionMax: 2200, countUnit: "chars" },
    notes: [
      "Page-only (Page access token). Three phases: start → upload to rupload.facebook.com → finish with video_state.",
      "Longer vertical videos can be posted as regular Page videos instead of Reels.",
    ],
    source: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
    verifiedAt: "2026-10",
  },
  x: {
    id: "x",
    label: "X",
    minSec: 0.5,
    maxSec: 1200,
    maxBytes: 8 * 2 ** 30,
    aspects: ["16:9", "9:16", "1:1"],
    recommended: VERT,
    text: { captionMax: 280, countUnit: "chars" },
    notes: [
      "Use /2/media/upload/initialize → /{id}/append (≤ 5 MB segments recommended, 8 MB max) → /{id}/finalize, then poll STATUS.",
      "Premium accounts allow 125 min / 16 GB; default 20 min / 8 GB per X docs (tweet_video).",
      "API access tier and per-endpoint caps apply; budget media calls.",
      "Long text needs Premium; otherwise 280 weighted chars (URLs count 23).",
    ],
    source: "https://docs.x.com/x-api/media/quickstart/media-upload-chunked",
    verifiedAt: "2026-10",
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    minSec: 3,
    maxSec: 1800,
    maxBytes: 5 * 2 ** 30,
    aspects: ["16:9", "9:16", "1:1", "4:5"],
    recommended: VERT,
    text: { captionMax: 3000, countUnit: "chars" },
    notes: [
      "Videos API: initializeUpload → PUT each part to uploadInstructions → finalizeUpload with ETags → Posts API.",
      "Requires w_member_social (member) or w_organization_social (page) and a LinkedIn-Version header.",
    ],
    source: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api",
    verifiedAt: "2026-10",
  },
  threads: {
    id: "threads",
    label: "Threads",
    minSec: 1,
    maxSec: 300,
    maxBytes: 1 * 2 ** 30,
    aspects: ["9:16", "1:1", "16:9"],
    recommended: VERT,
    text: { captionMax: 500, countUnit: "chars" },
    notes: ["Video must be at a public URL; create container → poll status → threads_publish."],
    source: "https://developers.facebook.com/docs/threads/posts",
    verifiedAt: "2026-10",
  },
  pinterest: {
    id: "pinterest",
    label: "Pinterest",
    minSec: 4,
    maxSec: 900,
    maxBytes: 2 * 2 ** 30,
    aspects: ["9:16", "1:1", "2:3"],
    recommended: VERT,
    text: { titleMax: 100, captionMax: 800, countUnit: "chars" },
    notes: ["Register media (POST /v5/media) → upload to the returned S3 URL → poll → create pin with media_source video_id and a cover image."],
    source: "https://developers.pinterest.com/docs/api/v5/",
    verifiedAt: "2026-10",
  },
  bluesky: {
    id: "bluesky",
    label: "Bluesky",
    minSec: 1,
    maxSec: 180,
    maxBytes: 100 * 2 ** 20,
    aspects: ["9:16", "16:9", "1:1"],
    recommended: { ...VERT, videoKbps: 4000 },
    text: { captionMax: 300, countUnit: "graphemes" },
    notes: ["Upload via the video service (app.bsky.video.uploadVideo) with a service-auth token, poll job status, then post an app.bsky.embed.video record.", "Daily upload caps apply per account."],
    source: "https://docs.bsky.app/docs/tutorials/video",
    verifiedAt: "2026-10",
  },
};

const overrides: Partial<Record<Platform, Partial<PlatformSpec>>> = {};

export function overridePlatformSpec(p: Platform, patch: Partial<PlatformSpec>): void {
  overrides[p] = { ...(overrides[p] ?? {}), ...patch };
}

export function platformSpec(p: Platform): PlatformSpec {
  return { ...SPECS[p], ...(overrides[p] ?? {}) } as PlatformSpec;
}

export function allPlatformSpecs(): PlatformSpec[] {
  return (Object.keys(SPECS) as Platform[]).map(platformSpec);
}
