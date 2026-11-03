---
name: publish-social
description: Publish rendered videos to YouTube/Shorts, TikTok, Instagram Reels, Facebook Reels, X, LinkedIn, Threads, Pinterest, Bluesky or any webhook (Zapier, Make, n8n, Buffer, Ayrshare) with per-platform copy, OAuth token refresh and each API's limits handled. Use when asked to post, schedule or distribute a video, or to connect a social account.
---

# Publish to social

## Connect accounts (once)

- CLI: `vidsk auth youtube|tiktok|x|linkedin|pinterest|threads|meta`. This opens the consent URL, catches the callback on localhost and stores tokens in `~/.vidsk/tokens.json` (mode 600).
- Worker: `GET /oauth/<platform>/start?token=<VIDSK_API_TOKEN>`. Tokens are AES-GCM encrypted in KV.
- Or paste tokens as env/secrets (see `.env.example`). They are seeded into the token store on first use.

X and TikTok **rotate refresh tokens** on every refresh, and the store persists the new one automatically. Env-only setups can't persist rotation, so use the CLI file store or KV.

## Publish

- MCP: `publish_job { jobId, platforms? }`. Copy comes from the job's `copy` stage, or pass `copy`.
- CLI: `vidsk publish out/<job>.mp4 --title "…" --platforms tiktok,x`, or `vidsk publish --job <id>`.
- Automatic: the pipeline publishes after QA passes (`publishWhen: "qa-pass"`), and the Worker cron does this for queued topics.

## Platform gotchas (handled in code; know them when debugging)

| Platform | Gotcha | Handling |
| --- | --- | --- |
| YouTube | Unaudited API projects force **private**. Captions and thumbnails are separate calls | Resumable chunked upload with resume-on-failure. SRT via captions.insert. Private status is reported as a warning. `containsSyntheticMedia` is set |
| TikTok | Unaudited apps can only post **SELF_ONLY**. Chunks 5–64 MB, ≤ 1000. 6 inits per minute | Privacy negotiated from `creator_info`, chunk math, rate limiter, `is_aigc`, inbox/draft mode |
| Instagram | Needs a professional account. Per-account 24 h publishing cap | `content_publishing_limit` checked first. Resumable rupload (no public URL needed). Container status polling |
| Facebook Reels | 3–90 s, Page token only | Validated before upload. start → rupload → finish |
| X | v2 `/2/media/upload/initialize|append|finalize`. 280 weighted chars | 4 MB segments, STATUS polling, URL = 23 chars |
| LinkedIn | Little-text-format escaping. Versioned API | Reserved characters escaped, `{hashtag|\#|tag}` templates, ETag-based finalize |
| Threads / Pinterest | Threads needs a public HTTPS video URL | Signed R2 URLs from the Worker `/files` route |
| Bluesky | ≤ 100 MB / 3 min, service-auth upload | Hashtag facets with UTF-8 byte offsets |

Validation runs before any upload (`validate()`), so oversize or overlong videos are skipped with a reason instead of burning quota. Copy is adapted per platform by `adaptCopy()`; MCP `adapt_copy` previews it.

Details: `docs/distribution.md`.
