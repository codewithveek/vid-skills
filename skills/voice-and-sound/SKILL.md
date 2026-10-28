---
name: voice-and-sound
description: Voice-over, music, sound effects and mastering for short videos with any TTS/music provider. Covers open models (Kokoro, Piper/Chatterbox via OpenAI-compatible servers) and paid ones (ElevenLabs, OpenAI, Cartesia, Google, Azure, Deepgram), word alignment, ducking, drops and loudness targets. Use when choosing or debugging a voice, music bed, SFX, or audio levels.
---

# Voice and sound

## Pick a voice provider (`VIDSK_TTS`, comma = failover chain)

| Spec | Cost | Timestamps | Notes |
| --- | --- | --- | --- |
| `kokoro:am_michael` | free, Apache-2.0 | word (Kokoro-FastAPI) / none (CLI) | Runs on CPU. The CLI falls back to `hyperframes tts` locally, and the Cloudflare container serves it too |
| `elevenlabs:<voiceId>@eleven_multilingual_v2` | paid | char → word | Best expressiveness. v3 has no request stitching; use audio tags |
| `openai:onyx@gpt-4o-mini-tts` | paid | none | `instructions` steer delivery. 4,096 chars per request |
| `cartesia:<voiceId>` | paid | word (SSE) | Low latency |
| `google:en-US-Neural2-D` | paid | word (SSML marks) | 5,000-byte limit |
| `azure:<voice>` / `deepgram:<model>` / `workers-ai` | paid / free tier | none | |
| `compat:<baseUrl>#<model>` | your server | none | Any OpenAI-compatible `/audio/speech` (Orpheus, Chatterbox, LocalAI…) |

The reference voice is a male, expressive narrator at about 122 Hz median pitch and **~172 wpm**. Kokoro `am_michael` at speed 1.08 is a good open match.

**Alignment** never blocks a run: provider timestamps first, then STT (`VIDSK_STT`: groq, openai, deepgram, elevenlabs, workers-ai, local whisper), then syllable-weighted estimation (±120 ms). Whisper hallucinations over silence are filtered.

**Chunking**: the pipeline synthesizes one clip per beat under the provider's `maxCharsPerRequest` and passes previous/next text when the provider supports stitching. No audio is decoded on Workers.

## Music (`VIDSK_MUSIC`)

`elevenlabs` (commercial), `stability`, or `fal:<model>` / `replicate:<model>` with `VIDSK_MUSIC_INPUT` as a JSON template. Beware: MusicGen weights are non-commercial, and `licensedOnly` briefs refuse them. Prompt by **feel and tempo**, never by artist. Beds shorter than the video are looped with 1 s crossfades.

## Mix plan (automatic)

- Voice at 1.0, with a highpass at 80 Hz and a −1 dB limiter (HyperFrames `data-fx-chain`).
- Bed at 0.14 under the voice (about 13 dB down, as measured), rising to 0.45 in gaps over 0.7 s, through clip-relative `data-automation` lanes.
- **Drops**: the bed goes to 0 for about 0.8 s before every `musicCue: "drop"` beat (the reference drops at 21.9 s and 87.7 s).
- SFX: two takes per cue, rotated, placed one frame after the visible action, 3–6 dB over the bed. Cuts are not whoosh-scored.
- Mastering after render: two-pass `loudnorm` to **−14 LUFS**, then a true-peak limiter at **−1 dBTP**, AAC 192 k at 48 kHz.

## Debug

`vidsk audit out/<job>.mp4` measures the result (integrated LUFS, true peak, drops, pitch). QA flags loudness outside −14 ± 2 and true peak above −0.9.
