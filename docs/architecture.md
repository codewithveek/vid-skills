# Architecture

```
                ┌──────────── any model / any host ────────────┐
                │ MCP client · function calling · REST · CLI · │
                │ Claude/Codex/Cursor/Gemini skills & agents   │
                └───────────────┬──────────────────────────────┘
                                │  JSON-schema contracts (packages/core/spec.ts)
┌───────────────────────────────▼───────────────────────────────────────────────┐
│ @vid-skills/core (runtime-agnostic: Workers · Node · Deno · Bun · browser)     │
│                                                                               │
│ research ─► script ─► storyboard ─► voice ─► assets ─► timeline ─► sound ─►    │
│ compose (HyperFrames) ─► render ─► qa ─► copy ─► publish                       │
│                                                                               │
│ • generateStructured: schema-in-prompt, tolerant JSON, zod repair, continuation│
│ • timing engine: cuts land on anchor words, montages on list words, frame-exact│
│ • sound plan: ducking lanes, music drops, action-only SFX, loop + crossfade   │
│ • HyperFrames compiler: scenes, persistent headline, captions, audio graph    │
│ • QA: hook, pacing, citations, licenses, platform limits, loudness            │
│ • checkpointed stages (Storage) → idempotent, resumable, durable              │
└───────┬───────────────────────────┬──────────────────────────┬────────────────┘
        │ provider interfaces       │ RenderBackend            │ Publisher
┌───────▼──────────┐   ┌────────────▼─────────────┐   ┌────────▼─────────────────┐
│ @vid-skills/     │   │ @vid-skills/renderer     │   │ @vid-skills/distribute   │
│ providers        │   │ (Node / Container)       │   │ YouTube · TikTok · IG ·  │
│ LLM · TTS · STT  │   │ HyperFrames CLI render   │   │ FB · X · LinkedIn ·      │
│ music · SFX ·    │   │ ffmpeg derive/master     │   │ Threads · Pinterest ·    │
│ stock · image ·  │   │ audit engine             │   │ Bluesky · webhook        │
│ video · research │   │ Kokoro/whisper local     │   │ OAuth + rotation + copy  │
│ limits registry  │   │ HTTP server              │   │ adaptation + validation  │
└──────────────────┘   └──────────────────────────┘   └──────────────────────────┘
```

## Why this split

- **Model-agnostic by construction.** Models only produce four JSON documents (dossier, script, storyboard, copy) against published schemas. Everything that has a right answer (timing, layout, loudness, chunk sizes, platform rules) is code, so a 7B local model and a frontier model produce the same structural quality. When a model fails validation three times, deterministic fallbacks take over (for example the rule-based storyboard).
- **Durable and hands-free.** Every stage writes a checkpoint, so the same code runs as one process (CLI), as Workflow steps (Cloudflare), or as individual MCP tool calls an agent orchestrates. Retries never redo paid work.
- **HyperFrames as the render target.** Videos are HTML + GSAP, so agents can read and edit them, people can edit them in the HyperFrames desktop app, and renders are deterministic (`hyperframes check` passes on generated projects).
- **Workers where possible, containers where necessary.** Only rendering, ffmpeg and local models need a real OS. The Worker orchestrates, and the Container renders and serves Kokoro TTS.

## Data flow of one job

1. `VideoBrief` → `ResearchDossier` (search + read + LLM) → `Script` → `Storyboard`.
2. Voice: one TTS call per beat chunk (≤ provider limit, with context stitching) → word timings (provider, then STT, then estimate) → `VoiceTrack`.
3. Assets: stock (rate-limited, license-filtered, circuit-breakered), then generation, then placeholder → stored in job storage (never hotlinked).
4. Timeline: cuts on anchor words, montages on list words, min/max shot rules, frame quantization, captions.
5. Sound: music (looped), SFX takes, automation lanes (duck/drop) → `AudioClip[]`.
6. Compose: `index.html` + one composition per shot + chrome + captions, plus asset manifest with licenses and derived pre-blurred fills.
7. Render: materialize → derive → `hyperframes render` → two-pass loudnorm + true-peak limiter.
8. QA → copy → publish (only when QA passes, unless configured otherwise).

## Storage layout

```
jobs/<jobId>/manifest.json           JobManifest (stages, assets, outputs, publications)
jobs/<jobId>/stages/<stage>.json     checkpoints
jobs/<jobId>/assets/*                voice, music, sfx, visuals
jobs/<jobId>/project/*               HyperFrames project
jobs/<jobId>/video.mp4, captions.srt
```
