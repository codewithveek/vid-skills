# AGENTS.md

Instructions for any coding or chat agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot, Goose, Aider…) working in or with this repository.

## What this repo is

`vid-skills` produces short-form "framed explainer" videos hands-free: research → script → voice → assets → sound → HyperFrames composition → render → QA → publish. It is model-agnostic. Every model call goes through JSON-schema contracts with repair loops, and timing, layout, mixing and compliance are deterministic code.

## Use it (as an agent)

- **MCP**: `node packages/cli/bin/vidsk.mjs mcp` (stdio) or `vidsk serve` (HTTP `/mcp`). Already wired in `.mcp.json` (Claude Code) and `gemini-extension.json`.
- **Skills**: `skills/*/SKILL.md`. Start with `skills/explainer-video/SKILL.md`.
- **Agent persona**: `agents/video-producer.md` (also in `.claude/agents/`).
- **Tool definitions for function calling**: `vidsk tools --format openai|anthropic|gemini|openapi`.

## Develop it

| Task | Command |
| --- | --- |
| Install | `pnpm install` (Node ≥ 22) |
| Regenerate prompts/docs bundles | `pnpm gen` (edit `prompts/*.md`, never `*.generated.ts`) |
| Typecheck | `pnpm typecheck` |
| Test | `pnpm test` |
| Lint skills | `pnpm lint:skills` |
| Render a project | `vidsk render <dir>` (needs ffmpeg + `npx hyperframes browser ensure`) |
| Validate a project | `vidsk check <dir>` (HyperFrames lint/layout/motion/craft) |

## Layout

```
packages/core        runtime-agnostic: schemas (zod), timing engine, captions, sound plan, HyperFrames compiler, QA, pipeline
packages/providers   fetch-only adapters: LLM / TTS / STT / music / SFX / stock / image / video / research / remote render + limits registry
packages/distribute  YouTube, TikTok, Instagram, Facebook, X, LinkedIn, Threads, Pinterest, Bluesky, webhook + OAuth + copy adaptation
packages/mcp         MCP server (tools/resources/prompts), Streamable HTTP + stdio framing, OpenAI/Anthropic/Gemini/OpenAPI exports
packages/renderer    Node: HyperFrames render, ffmpeg mastering, audit engine, local Kokoro/whisper, HTTP render server
packages/cli         `vidsk` command
apps/worker          Cloudflare Worker + Workflows + R2 + KV + Container
skills/ agents/ prompts/ docs/ examples/
```

## Rules for changes

- `core`, `providers`, `distribute` and `mcp` must stay **Workers-safe**: no Node built-ins, only `fetch`/Web Crypto.
- Keep the HyperFrames contract in generated HTML (see `skills/storyboard-and-motion/SKILL.md`), and run `vidsk check` on a generated project after compiler changes.
- New provider: implement the interface in `core/src/providers.ts`, add it to `registry.ts`, and add an entry with real limits, workarounds, source and date to `providers/src/limits.ts`.
- New platform: implement `PlatformPublisher` and add its spec to `core/src/platforms.ts`.
- Tests live next to each package in `test/`. Mock `fetch`; never hit real APIs in tests.
