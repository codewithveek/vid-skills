---
name: explainer-video
description: Make a vertical "framed explainer" short (persistent headline, 16:11 media window over a blurred fill, literal b-roll on anchor words, 0.2 s list montages, dark-UI diagrams, typewriter year cards, music drops before the twist, metaphor CTA) end-to-end and hands-free with HyperFrames. Covers research, script, voice-over, sound, motion, render, QA and publishing. Use for any request to make videos like the reference explainer, faceless educational shorts, or TikTok/Reels/Shorts explainers.
---

# Framed explainer video

The format comes from the measured reference in `docs/audit/power-button-explainer.md`. Everything here works with **any model**: the deterministic parts (timing, layout, mixing, compliance) live in code, and the model only writes research, script, storyboard and copy against JSON schemas.

## Fastest path

Pick whichever surface you have:

| Surface | Command |
| --- | --- |
| MCP (Claude Code/Desktop, Cursor, Codex, Gemini CLI, Goose, any MCP client) | `make_video` with `{ brief: { topic }, stopAfter: "compose" }`, then `job_status` → `get_project_file` / `put_project_file` → `render_job` → `qa_report` → `publish_job` |
| CLI | `vidsk make "<topic>" --platforms youtube_shorts,tiktok --handle @you [--publish]` |
| HTTP | `POST /api/jobs { brief, publish }` on the Cloudflare Worker, poll `GET /api/jobs/<id>` |
| Library | `runPipeline(brief, { providers, storage })` from `@vid-skills/core` |

Call `describe_setup` (MCP) or `vidsk doctor` first to see which providers are configured.

## The brief

```json
{
  "topic": "why the power button symbol means standby",
  "angle": "the icon on every device originally meant 'not really off'",
  "durationSec": 75,
  "platforms": ["youtube_shorts", "tiktok", "instagram_reels"],
  "handle": "@yourchannel",
  "voice": { "provider": "kokoro", "voice": "am_michael", "speed": 1.08 },
  "music": { "enabled": true, "prompt": "minimal dark tech pulse, 118 bpm, no vocals", "drops": true }
}
```

Full schema: MCP resource `vidsk://schemas` → `VideoBrief`.

## Format rules (don't break these)

1. **Frame 0 is the hook**: a striking visual plus the headline already on screen. Never black, never a logo.
2. **Headline**: ≤ 6 words, ≤ 40 characters, a claim and not a question. It stays on screen for the whole video.
3. **Script formula**: hook (imperative, ≤ 12 words) → stakes → **twist** (music drops to silence for about 0.7 s before it) → history/mechanism → proof → payoff → CTA that reuses the topic's metaphor. Add a turn word ("Except", "Then", "By 2004") every 20–30 s. About 170 wpm.
4. **Every factual line cites claim ids** from the research dossier. QA blocks publishing on uncited facts when `requireSources` is on.
5. **Visual literalness**: each shot lands on its anchor word (the engine does this from word timings). Lists of 3+ items become montages cut on each list word (0.2–0.27 s). Years become typewriter cards. Mechanisms become diagrams. "The rulebook says…" becomes a document with a highlighter.
6. **Analogy inserts** every 20–40 s, using original or stock imagery with a white tag. Never film or TV clips, celebrities, or logos as the hero.
7. **Sound**: SFX only on visible actions (click, pop, tick, swipe), never on every cut. Bed about 13 dB under the voice. Master to −14 LUFS and −1 dBTP.
8. **Captions** burned in under the window (most viewers watch muted).

## When things are missing

The pipeline degrades instead of failing. Without a research provider it uses the model's knowledge (claims capped at medium confidence). Without TTS timestamps it aligns with STT, or estimates. Without stock it generates images, and without image generation it uses styled placeholder cards. Without a music provider it ships with no bed. Without an SFX provider it uses procedural foley. QA reports every degradation.

## Editing the result

The output is a normal HyperFrames project (`index.html` + `compositions/s-<shot>.html` + `chrome.html` + `captions.html`). Open it with `npx hyperframes preview <dir>`, edit it in the HyperFrames desktop app, or change files with `put_project_file`, then re-render. Keep the contract: `class="clip"` + `data-start`/`data-duration`, paused timelines registered on `window.__timelines`, `fromTo` tweens, and no `Date.now`/`Math.random`. Run `vidsk check <dir>` (HyperFrames lint plus layout, motion and craft checks) before rendering.

## Related skills

`research-and-script`, `storyboard-and-motion`, `voice-and-sound`, `publish-social`, `video-audit`, `deploy-cloudflare`.
