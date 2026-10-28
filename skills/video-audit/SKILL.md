---
name: video-audit
description: Deconstruct a reference video into measurable numbers covering layout bands, palette, shot-length distribution, montages, motion vocabulary, loudness, music drops, voice pitch and pacing, and script formula, then turn them into a reusable style pack. Use when someone shares a video and says "make videos like this", "analyse this video", or "what makes this work".
---

# Video audit

## Run it

- CLI: `vidsk audit <video.mp4> --out ./audit [--transcribe]` writes `audit.json`, `audit.md`, contact sheets (1 frame/s) and frame-by-frame strips of every montage.
- MCP: `audit_video { url | key, transcribe }`. It needs a Node host with ffmpeg (CLI or the render container).
- Render node: `POST /audit` (multipart `file`).

## What it measures, and why

| Measurement | How | Feeds |
| --- | --- | --- |
| Frame timing, codec, bitrate | ffprobe + per-frame PTS | master export settings |
| Cuts, shot histogram, montages (≥ 3 cuts < 0.4 s apart) | ffmpeg `scdet` per frame | `motion.montagePerItemSec`, pacing QA |
| Persistent overlay bands (headline, watermark) | low temporal variance + high spatial detail per row | `layout().title` |
| Content window | strongest persistent horizontal edges outside overlay bands | `layout().window` (the reference measures 25.6–64.4 %, 1.45:1) |
| Palette | quantized color histogram (dominant + saturated accents) | `palette` |
| Loudness, LRA, true peak, momentary curve | EBU R128 (`ebur128`) | `audio.targetLufs`, limiter |
| Silences and drops | `silencedetect` (−40 dB, 0.25 s) | `musicCue: "drop"` placement |
| Voice pitch | autocorrelation over voiced frames | voice choice |
| Words, wpm, pauses | STT with hallucination guard | `voice.targetWpm`, `pauseAfterSec` |

## Then do the human part

1. Look at the contact sheets. Name each scene type you see (b-roll, montage, diagram, typewriter, document, analogy, CTA) and map it to the `Scene` union in `vidsk://schemas`.
2. Transcribe and label the beats (hook, stakes, twist, history, mechanism, proof, payoff, CTA) with timestamps. Note where the music drops.
3. Write a style pack (`packages/core/src/styles/*.ts`, registered with `registerStyle`) using the measured numbers, never guesses.
4. List what to **improve** over the reference (the reference clipped at +0.1 dBTP, shipped at 576p, had no captions, and used unlicensed movie clips).

The worked example is `docs/audit/power-button-explainer.md`.
