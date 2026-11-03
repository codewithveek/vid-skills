# vid-skills

**Hands-free, model-agnostic short-form video production with [HyperFrames](https://github.com/heygen-com/hyperframes).**
Research → cited script → voice-over → stock/generated visuals → music, SFX and mix → HyperFrames motion graphics → render → QA → publish to YouTube, TikTok, Instagram, Facebook, X, LinkedIn, Threads, Pinterest and Bluesky.

It is built from a [frame-by-frame audit](docs/audit/power-button-explainer.md) of a high-performing "framed explainer" short. The persistent headline, 16:11 window over a blurred fill, cuts on anchor words, 0.2 s list montages, dark-UI diagrams, typewriter year cards, music drops before the twist and metaphor CTA are all measured and encoded as a style pack. You can run it as **skills**, an **agent**, an **MCP server**, plain **function-calling tools**, a **REST/OpenAPI** service, a **CLI**, a **library**, or a **Cloudflare Worker** that posts on a schedule.

```bash
pnpm install
npx hyperframes browser ensure                     # once: headless Chrome for rendering
cp .env.example .env                               # add whatever keys you have (none are strictly required)
node packages/cli/bin/vidsk.mjs doctor
node packages/cli/bin/vidsk.mjs make "why the power button symbol means standby" --handle @you
```

Zero-API demo, fully offline except for keyless stock and Wikimedia: replay a canned script with local Kokoro TTS (`pip install kokoro-onnx soundfile`).

```bash
VIDSK_LLM=static:examples/replay/power-button.json VIDSK_RESEARCH=none VIDSK_STOCK=wikimedia \
  node packages/cli/bin/vidsk.mjs make "the power button symbol" --handle @you
```

## What's inside

| Path | What |
| --- | --- |
| [`docs/audit/`](docs/audit/power-button-explainer.md) | Deep audit of the reference video: layout bands, palette, 76 cuts and shot histogram, montages, motion vocabulary, voice (172 wpm, 122 Hz), mix (−14.3 LUFS, drops at 21.9 s/87.7 s), script formula, what to improve |
| `packages/core` | Workers-safe core: zod schemas → JSON Schema, structured-output harness, timing engine, captions, sound plan, **HyperFrames compiler**, QA, checkpointed pipeline |
| `packages/providers` | LLM (OpenAI-compatible, Anthropic, Gemini, Workers AI, fallback chains), TTS (Kokoro, ElevenLabs, OpenAI, Cartesia, Google, Azure, Deepgram, Workers AI), STT, music, SFX, stock, image/video generation, research, remote render, plus a [limits & workarounds registry](docs/provider-limits.md) |
| `packages/distribute` | Chunked/resumable uploaders for 9 platforms + webhook, OAuth (PKCE, rotating refresh tokens, encrypted KV), per-platform copy adaptation |
| `packages/mcp` | MCP server (16 tools, resources, prompts) over stdio and Streamable HTTP; OpenAI/Anthropic/Gemini tool exports; OpenAPI |
| `packages/renderer` | Node render node: HyperFrames render, ffmpeg derivatives and mastering (−14 LUFS / −1 dBTP), automated audit engine, local Kokoro and whisper, HTTP server |
| `packages/cli` | `vidsk make · resume · audit · render · check · publish · auth · mcp · serve · tools · doctor` |
| `apps/worker` | Cloudflare: Worker (MCP/REST/OAuth/signed media) + Workflows (durable stages) + R2 + KV + Workers AI + Container (render + Kokoro) + cron |
| `skills/` | Agent Skills: `explainer-video`, `video-audit`, `research-and-script`, `storyboard-and-motion`, `voice-and-sound`, `publish-social`, `deploy-cloudflare` |
| `agents/video-producer.md` | Model-agnostic producer agent (also a Claude Code subagent) |
| `prompts/` | Editable prompt templates, compiled into the bundle |

## How it stays model-agnostic and hands-free

- Models only write four JSON documents (dossier, script, storyboard, copy). `generateStructured` handles models without JSON mode, prose around JSON, truncated output and invalid fields, with a schema-in-prompt plus example, tolerant extraction, a zod repair loop and continuation. Deterministic fallbacks cover persistent failures.
- Timing, layout, mixing, chunking, platform rules and licensing are code. A 7B local model and a frontier model get the same structural quality.
- Every limit has a workaround in code: TTS character caps (chunking + context stitching), missing timestamps (STT, then estimation), Whisper hallucinations (silence guard), music length caps (loop + crossfade), rate limits (token buckets + Retry-After), dead providers (circuit breakers + fallback chains), Workers memory (ranged R2 reads, streamed renders, signed URLs), HyperFrames determinism (`fromTo`, `immediateRender:false`, seeded randomness, pre-blurred fills). See [docs/provider-limits.md](docs/provider-limits.md).
- Stages checkpoint to storage, so runs resume after crashes and Workflow retries never repay for finished work.
- QA gates publishing: frame-0 hook, pacing, uncited facts, licenses, placeholders, caption coverage, platform limits, loudness.

## Use it from…

- **Claude Code / Desktop, Cursor, Codex, Gemini CLI, Goose, any MCP client**: see [docs/integrations.md](docs/integrations.md). `.mcp.json`, `.claude-plugin/` and `gemini-extension.json` are included.
- **Any function-calling model**: `vidsk tools --format openai|anthropic|gemini`, executed via `POST /api/tools/<name>`.
- **n8n / Zapier / Make / GPT Actions**: `/openapi.json`.
- **Cloudflare**: [skills/deploy-cloudflare](skills/deploy-cloudflare/SKILL.md).

More docs: [architecture](docs/architecture.md) · [distribution setup](docs/distribution.md) · [provider limits](docs/provider-limits.md).

## Develop

```bash
pnpm gen          # compile prompts/docs into the bundles + regenerate provider-limits.md
pnpm typecheck
pnpm test         # mocks fetch; never hits real APIs
pnpm lint:skills
node packages/cli/bin/vidsk.mjs check <projectDir>   # HyperFrames lint/layout/motion/craft
```

License: Apache-2.0. Rendering uses HyperFrames (Apache-2.0) and GSAP (standard no-charge license). Check the license of every model and stock source you enable; the asset manifest (`vidsk.assets.json`) records each one.
