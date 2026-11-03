# Distribution setup

Each platform is enabled when its credentials exist, either as env/secrets or in the token store (`~/.vidsk/tokens.json` for the CLI, encrypted KV for the Worker). Connect an account with `vidsk auth <platform>` (CLI) or `GET /oauth/<platform>/start?token=…` (Worker). The redirect URI to register in each developer console is:

- CLI: `http://localhost:8789/callback` (override with `VIDSK_REDIRECT_URI`)
- Worker: `https://<your-worker>/oauth/<platform>/callback`

| Platform | Developer app | Scopes / permissions | Env | Approval needed for public posting |
| --- | --- | --- | --- | --- |
| YouTube / Shorts | Google Cloud project → YouTube Data API v3 → OAuth client | `youtube.upload`, `youtube.force-ssl` | `YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN`, `YOUTUBE_PRIVACY` | API project **audit** (otherwise uploads are forced private) |
| TikTok | TikTok for Developers → Content Posting API (Direct Post) | `video.publish`, `video.upload` | `TIKTOK_CLIENT_KEY/SECRET/REFRESH_TOKEN`, `TIKTOK_MODE` | App **audit** (otherwise SELF_ONLY on private accounts) |
| Instagram Reels | Meta app + Instagram professional account linked to a Page | `instagram_basic`, `instagram_content_publish`, `pages_show_list` | `INSTAGRAM_USER_ID`, `INSTAGRAM_ACCESS_TOKEN` (long-lived) | App Review for public apps |
| Facebook Reels | Meta app + Page | `pages_manage_posts`, `pages_read_engagement` | `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN` | App Review for public apps |
| Threads | Meta app with Threads use case | `threads_basic`, `threads_content_publish` | `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` (auto-refreshed) | App Review; needs public video URLs |
| X | X developer project (OAuth 2.0, PKCE) | `tweet.write`, `users.read`, `media.write`, `offline.access` | `X_CLIENT_ID/SECRET/REFRESH_TOKEN` | Paid API tier for meaningful volume |
| LinkedIn | LinkedIn app + Share on LinkedIn / Community Management | `w_member_social` (or `w_organization_social`) | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | Community Management API for org pages |
| Pinterest | Pinterest app | `pins:write`, `boards:read` | `PINTEREST_ACCESS_TOKEN`, `PINTEREST_BOARD_ID` | Standard access |
| Bluesky | none (app password) | — | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | — |
| Anything else | Zapier / Make / n8n / Buffer / Ayrshare / Upload-Post | — | `PUBLISH_WEBHOOK_URL`, `PUBLISH_WEBHOOK_SECRET` (HMAC `x-vidsk-signature`) | — |

## Behaviour

- **Validate before upload**: duration, size and aspect against `core/src/platforms.ts`. Failures are reported as `skipped` with the reason.
- **Copy per platform** (`adaptCopy`): YouTube title ≤ 100, tags ≤ 480 chars; TikTok/IG/FB hook + description + 5–6 hashtags; X weighted 280 (URLs count 23); LinkedIn little-text escaping with hashtag templates; Bluesky ≤ 300 graphemes with tag facets.
- **AI disclosure**: `containsSyntheticMedia` (YouTube) and `is_aigc` (TikTok) are set by default.
- **Large files**: uploads read the video in ranges (R2/fs), so Workers never hold a whole video in memory, except for APIs that need a single body (Meta rupload, Bluesky, Pinterest).
- **Results** are recorded on the job manifest (`publications[]`) with remote ids and URLs.

Specs and gotchas per platform are in `docs/provider-limits.md` (generated) and `core/src/platforms.ts`.
