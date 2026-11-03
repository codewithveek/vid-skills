---
name: storyboard-and-motion
description: Turn a narration script into anchored shots (broll, montage, diagram, typewriter, document, analogy, stat, quote, cta, endcard) and edit the generated HyperFrames compositions (HTML + GSAP) safely. Use when planning visuals for a script, changing a scene's look or motion, or fixing HyperFrames lint, layout or craft warnings.
---

# Storyboard and motion

## Shots (`Storyboard`)

Each shot has `{ id, lineId, anchor?, scene }`. The **anchor** is a word or phrase in the line, and the cut lands on it (computed from word timings, never guessed).

| Scene | Use for | Key fields |
| --- | --- | --- |
| `broll` | literal nouns | `asset.query` (2–5 words), `asset.prompt` fallback, `treatment` (natural/bw/dark/warm/cool/vintage), `move` (pushIn/pullOut/pan*/kenBurns/static), `focusY` (0 = top of a tall photo, for faces) |
| `montage` | lists of 3+ | `items[]` (one per list item). Items cut on each list word, 0.2–0.27 s |
| `diagram` | mechanisms | `template`: icon-draw, button-cards, toggle-switch, flow, compare, counter, timeline, checklist. Icons: any [Lucide](https://lucide.dev/icons) name (2,000+ bundled, ISC; drawn on stroke by stroke) plus the IEC power set. Pick a literal icon (bug, scroll-text, traffic-cone); check/x are a last resort. `compare` takes `leftTitle`/`rightTitle` (a year beats an icon). |
| `versus` | then vs now, myth vs fact | Two photo cards with a big year/number and a label each, a red VS badge, a yellow ring on the `winner`. Each side: `asset` (preferred), or `icon`, or title only. Use it instead of `compare` whenever both sides are real things. |
| `typewriter` | years and single striking words | `lead` ("Back in"), `highlight` ("1973") |
| `document` | "the rulebook says" | page image or synthetic page, `highlights` (normalised boxes), `zoomTo`, `pageTurn` |
| `analogy` | every 20–40 s | relatable original/stock image plus a white `caption` tag |
| `stat`, `quote` | one number or one quote | cite `sourceClaimId` |
| `cta` | CTA line | `subscribe-morph` (power icon → pill → click → done state → light leak) |
| `endcard` | last 2.5 s | `handle` |

Assets: rights-safe stock first (Pexels, Pixabay, Unsplash, Openverse, Wikimedia), then image generation, then a styled placeholder. Never request film or TV clips or celebrities.

## The HyperFrames contract (what the compiler guarantees, and what your edits must keep)

- Every timed element has `class="clip"`, `data-start` and `data-duration` in seconds. Scene files wrap everything in `<template>` and style their root as `#root`.
- Each composition builds **one paused timeline** and registers it: `window.__timelines["<composition-id>"] = tl`.
- Use `fromTo` only. Repeated tweens on one element need `immediateRender:false` (the compiler's `stabilizeFromTo` adds it).
- Never tween a `.clip` itself, and never put a CSS `transform` on something GSAP transforms.
- No `Date.now()`, unseeded `Math.random()`, timers or infinite repeats. Use `seededRandom` from core.
- Blur-fill backgrounds are **pre-blurred derivatives** (`*.bg.jpg|mp4` made by the renderer with ffmpeg) rather than CSS blur on footage.
- Readability: nothing read under 28 px at 1080 wide. A closing line stays ≥ 2 s. A timeline label stays ≥ 0.8 s.

Check it with `vidsk check <projectDir>`. The generated reference project passes with 0 errors.

## Adding a scene type

Add it to the `Scene` union in `core/src/spec.ts`, write a renderer in `core/src/hyperframes/scenes.ts` (return `{css, html, js}`, prefix ids with `sid`), and add SFX defaults in `audio-plan.ts` if it has a visible action. Then document it in `prompts/storyboard.md`.
