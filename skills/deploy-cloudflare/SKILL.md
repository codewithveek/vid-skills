---
name: deploy-cloudflare
description: Deploy vid-skills to Cloudflare (Workers + Workflows + R2 + KV + Workers AI + a Container running the HyperFrames renderer and Kokoro TTS) for an always-on MCP endpoint, a REST API and scheduled hands-free publishing. Use when asked to deploy, host, schedule or automate the video pipeline in the cloud.
---

# Deploy to Cloudflare

Needs a Workers **Paid** plan (Containers and Workflows) and Docker locally for the container image build.

```bash
pnpm install
cd apps/worker
npx wrangler r2 bucket create vid-skills-media
npx wrangler kv namespace create KV        # paste the id into wrangler.jsonc
npx wrangler secret put VIDSK_API_TOKEN    # protects /mcp and /api
npx wrangler secret put VIDSK_SECRET       # signs /files URLs + encrypts tokens
npx wrangler secret put VIDSK_ORIGIN       # e.g. https://vid-skills.<you>.workers.dev
# provider keys as needed: ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY, …
npx wrangler deploy
```

## What runs where

| Piece | Runs on | Why |
| --- | --- | --- |
| MCP `/mcp`, REST `/api/tools/*`, OAuth, signed `/files` | Worker | fetch-only code from core/providers/distribute/mcp |
| Pipeline | **Workflows**: one durable step per stage, with retries and a 50-minute render step | Survives restarts. Checkpoints in R2 make retries idempotent |
| LLM / images / TTS (optional) | Workers AI binding or any API | `VIDSK_LLM=workers-ai:…`, `VIDSK_IMAGE=workers-ai` |
| Render + Kokoro TTS + ffmpeg | **Container** (`Dockerfile`) | Chrome and FFmpeg can't run in an isolate. Assets are pulled via signed URLs, so Worker memory stays flat |
| Media, checkpoints, projects | R2 | Ranged reads feed chunked social uploads |
| Tokens, topic queue | KV | AES-GCM encrypted tokens |
| Hands-free | Cron (`17 */6 * * *`) | Pops the next topic from `POST /api/topics` |

## Use it

```bash
curl -X POST $ORIGIN/api/topics -H "authorization: Bearer $TOKEN" -d '{"topics":["why airplane mode exists","the floppy disk save icon"]}'
curl -X POST $ORIGIN/api/jobs   -H "authorization: Bearer $TOKEN" -d '{"brief":{"topic":"why QWERTY"},"publish":false}'
```

MCP clients connect to `$ORIGIN/mcp` with `Authorization: Bearer $VIDSK_API_TOKEN`.

The container image can also be deployed on its own (Cloud Run, Fly, ECS). Point `VIDSK_RENDER=http:<url>` at it from any host.
