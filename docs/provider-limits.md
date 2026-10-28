# Provider limits and workarounds

> Generated from `packages/providers/src/limits.ts` by `scripts/gen-limits-doc.ts`. Limits change; every entry lists its source and when it was checked. Adapters read capabilities at runtime and env overrides win.

## LLM

### Any OpenAI-compatible chat API (OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Ollama, LM Studio, vLLM, llama.cpp)

- **id:** `openai-compatible` · **license:** per provider / model · **source:** https://platform.openai.com/docs/api-reference/chat (checked 2026-10)
- **configure:** `VIDSK_LLM=openai:<model>|openrouter:<model>|groq:<model>|ollama:<model>|compat:<baseUrl>#<model>`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`

**Limits**

- Dialects differ: reasoning models reject `max_tokens`/`temperature`; many local servers ignore `response_format: json_schema`.
- Small local models (≤ 8B) frequently emit prose around JSON, trailing commas, or truncated objects.
- Context windows vary from 4k (local) to 1M tokens.
- Rate limits surface as 429 with Retry-After or x-ratelimit-reset-* headers.

**Workarounds implemented**

- Adaptive dialect: on a 400 naming max_tokens / temperature / response_format, the adapter switches param or drops it and retries.
- generateStructured(): schema-in-prompt + example, tolerant JSON extraction, zod validation with path-precise repair loop (≤ 3 rounds), and continuation on finish_reason=length.
- Context fitting trims the longest non-system message from the middle to fit `contextTokens`.
- Deterministic fallbacks: storyboard falls back to a rule-based shot list; timing never depends on the model.
- FallbackLLM chain with circuit breaker; capabilities are the intersection of the chain.

### Anthropic Messages API (Claude)

- **id:** `anthropic` · **license:** commercial API · **source:** https://docs.anthropic.com/en/api/messages (checked 2026-10)
- **configure:** `VIDSK_LLM=anthropic:<model>`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`

**Limits**

- System prompt is a top-level field; consecutive same-role turns are rejected.
- No generic JSON mode in the classic Messages API path used here.
- Long outputs stop with stop_reason=max_tokens.

**Workarounds implemented**

- Adapter extracts system messages and merges consecutive turns.
- Structured output via generateStructured (schema-in-prompt + validation + repair).
- Continuation on max_tokens.

### Google Gemini (generateContent)

- **id:** `gemini` · **license:** commercial API · **source:** https://ai.google.dev/api/generate-content (checked 2026-10)
- **configure:** `VIDSK_LLM=gemini:<model>`, `GEMINI_API_KEY`

**Limits**

- Roles are user/model; system goes to systemInstruction.
- Thinking models may return thought parts.
- SAFETY finish reasons return empty text.

**Workarounds implemented**

- Role mapping + thought-part filtering.
- responseMimeType=application/json when JSON is requested.
- SAFETY → treated as failure so FallbackLLM moves on.

### Cloudflare Workers AI (binding env.AI or REST)

- **id:** `workers-ai` · **license:** per model · **source:** https://developers.cloudflare.com/workers-ai/models/ (checked 2026-10)
- **configure:** `VIDSK_LLM=workers-ai:@cf/<model>`, `CF_ACCOUNT_ID`, `CF_API_TOKEN (outside Workers)`

**Limits**

- Smaller open models; output token caps around 2–4k by default.
- Response shape varies by model (response string vs object).

**Workarounds implemented**

- Use as llmFast (copy, review) and keep a stronger primary.
- Shape normalisation in the adapter.

## TTS

### Kokoro-82M (open weights, via Kokoro-FastAPI or `hyperframes tts`)

- **id:** `kokoro` · **license:** Apache-2.0 · **source:** https://huggingface.co/hexgrad/Kokoro-82M (checked 2026-10)
- **configure:** `VIDSK_TTS=kokoro:<voice>`, `KOKORO_BASE_URL (default http://localhost:8880)`

**Limits**

- ~510 phoneme tokens per inference pass; long text must be split.
- No voice cloning; fixed voice set (af_*, am_*, bf_*, bm_*, …).
- No delivery instructions/emotion control.
- Word timestamps only via Kokoro-FastAPI /dev/captioned_speech.

**Workarounds implemented**

- Pipeline chunks by beat under 1,000 chars.
- Adapter uses captioned_speech for word timings, auto-falls back to /v1/audio/speech + STT/estimated alignment.
- speed 1.05–1.12 matches the reference's ~170 wpm delivery.
- Runs on CPU in a container next to the renderer, so a fully open-source, zero-API pipeline is possible.

### ElevenLabs TTS (with-timestamps)

- **id:** `elevenlabs` · **license:** commercial (per plan) · **source:** https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps (checked 2026-10)
- **configure:** `VIDSK_TTS=elevenlabs:<voiceId>@<model>`, `ELEVENLABS_API_KEY`

**Limits**

- Per-request character caps differ by model (≈5k v3, 10k multilingual_v2, 40k flash/turbo v2.5).
- eleven_v3 doesn't support previous_text/next_text stitching; it uses inline audio tags instead of instructions.
- Concurrency limits per plan → 429.
- PCM output formats may require higher tiers.

**Workarounds implemented**

- Capabilities derived from the model id; pipeline chunks below the cap.
- previous_text/next_text sent for prosody continuity on models that support it.
- Character alignment converted to word timings (no STT needed).
- MP3 default (frame-scanned duration, no decode needed on Workers).

### OpenAI TTS (gpt-4o-mini-tts, tts-1) and any OpenAI-compatible /audio/speech server

- **id:** `openai-tts` · **license:** commercial (disclose AI voice) · **source:** https://platform.openai.com/docs/guides/text-to-speech (checked 2026-10)
- **configure:** `VIDSK_TTS=openai:<voice>@<model>`, `OPENAI_API_KEY`

**Limits**

- 4,096 characters per request.
- No timestamps.
- `instructions` only on gpt-4o*-tts models.

**Workarounds implemented**

- Chunking; word timings from STT (if configured) or syllable-weighted estimation (±120 ms).
- Delivery direction passed as instructions when supported.

### Cartesia Sonic

- **id:** `cartesia` · **license:** commercial · **source:** https://docs.cartesia.ai/ (checked 2026-10)
- **configure:** `VIDSK_TTS=cartesia:<voiceId>@<model>`, `CARTESIA_API_KEY`

**Limits**

- Word timestamps only on streaming transports (SSE/WebSocket).

**Workarounds implemented**

- Adapter consumes SSE with add_timestamps and reassembles raw PCM into WAV.

### Google Cloud Text-to-Speech

- **id:** `google-tts` · **license:** commercial · **source:** https://cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize (checked 2026-10)
- **configure:** `VIDSK_TTS=google:<voiceName>`, `GOOGLE_TTS_API_KEY`

**Limits**

- 5,000-byte input limit including SSML markup.
- Timestamps only for SSML <mark> tags (v1beta1).

**Workarounds implemented**

- Inserts a <mark> before every word → word start times; caps chunks at 1,500 chars.

### Azure AI Speech (REST)

- **id:** `azure-tts` · **license:** commercial · **source:** https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech (checked 2026-10)
- **configure:** `VIDSK_TTS=azure:<voiceName>`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`

**Limits**

- Word-boundary events only through the SDK/WebSocket, not REST.
- ~10 minutes of audio per request.

**Workarounds implemented**

- STT or estimated alignment; SSML prosody for speed; mstts:express-as for style.

### Deepgram Aura

- **id:** `deepgram-tts` · **license:** commercial · **source:** https://developers.deepgram.com/docs/text-to-speech (checked 2026-10)
- **configure:** `VIDSK_TTS=deepgram:<model>`, `DEEPGRAM_API_KEY`

**Limits**

- 2,000 characters per request.
- No timestamps.

**Workarounds implemented**

- Chunking + STT/estimated alignment.

## STT

### Whisper (OpenAI whisper-1, Groq whisper-large-v3-turbo, faster-whisper servers, Workers AI)

- **id:** `whisper` · **license:** MIT weights / commercial APIs · **source:** https://platform.openai.com/docs/api-reference/audio/createTranscription (checked 2026-10)
- **configure:** `VIDSK_STT=openai|groq|deepgram|elevenlabs|workers-ai|compat:<baseUrl>#<model>`

**Limits**

- 25 MB per request on OpenAI/Groq.
- Hallucinates phrases ("Thanks for watching!") over silence/music — observed in the reference audit.
- gpt-4o-transcribe models don't return word timestamps.

**Workarounds implemented**

- Only short voice chunks are sent; oversize input falls back to estimation.
- guardHallucinations() drops words in silent regions and low-confidence outro phrases.
- Script text passed as `prompt` to bias spelling.

## MUSIC

### ElevenLabs Music

- **id:** `elevenlabs-music` · **license:** commercial (cleared per plan terms) · **source:** https://elevenlabs.io/docs/api-reference/music/compose (checked 2026-10)
- **configure:** `VIDSK_MUSIC=elevenlabs`, `ELEVENLABS_API_KEY`

**Limits**

- Track length bounded (≈10 s – 5 min).
- Prompts naming copyrighted artists/songs are rejected.

**Workarounds implemented**

- Prompt by feel/tempo, not artist ("minimal dark tech pulse, 118 bpm").
- Shorter-than-video beds are looped with 1 s crossfades and clip-relative automation.

### Stable Audio 2.x (Stability API)

- **id:** `stable-audio` · **license:** per Stability plan · **source:** https://platform.stability.ai/docs/api-reference (checked 2026-10)
- **configure:** `VIDSK_MUSIC=stability`, `STABILITY_API_KEY`

**Limits**

- Max ~3 minutes per generation.

**Workarounds implemented**

- Looping with crossfades for longer videos.

### Open music models on fal/Replicate (MusicGen, ACE-Step, Stable Audio Open…)

- **id:** `hosted-music` · **license:** varies — MusicGen weights are CC-BY-NC (non-commercial); ACE-Step is Apache-2.0 · **source:** https://fal.ai/models (checked 2026-10)
- **configure:** `VIDSK_MUSIC=fal:<model>|replicate:<model>`, `FAL_KEY`, `REPLICATE_API_TOKEN`, `VIDSK_MUSIC_INPUT (JSON template)`

**Limits**

- MusicGen ≈ 30 s per call and non-commercial weights.
- Async queues: minutes of latency under load.

**Workarounds implemented**

- `commercialUse` flag per model; licensedOnly briefs refuse NC models.
- Loop + crossfade; queue polling with backoff.

## SFX

### ElevenLabs SFX · Freesound · Openverse · procedural

- **id:** `sfx` · **license:** ElevenLabs royalty-free per plan; Freesound CC0 filter; Openverse commercial CC filter · **source:** https://freesound.org/docs/api/ (checked 2026-10)
- **configure:** `VIDSK_SFX=elevenlabs,freesound,openverse`, `FREESOUND_API_KEY`

**Limits**

- ElevenLabs SFX ≤ 30 s.
- Freesound needs a key; CC-BY requires attribution.
- Openverse anonymous rate limits.

**Workarounds implemented**

- Fallback chain ends in deterministic procedural foley (whoosh, click, tick, pop, swipe, riser, impact) so no run ships silent actions.
- Two takes per cue, rotated (repeated identical SFX is the most common tell).

## STOCK

### Pexels · Pixabay · Unsplash · Openverse · Wikimedia Commons

- **id:** `stock` · **license:** Pexels/Pixabay licenses (commercial OK); Unsplash License (+ API attribution rules); CC per file · **source:** https://www.pexels.com/api/documentation/ (checked 2026-10)
- **configure:** `VIDSK_STOCK=pexels,pixabay,unsplash,openverse,wikimedia`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `UNSPLASH_ACCESS_KEY`

**Limits**

- Pexels 200 req/h, 20k/month.
- Pixabay ~100 req/min; results cached ≤ 24 h, no permanent hotlinking.
- Unsplash demo keys 50 req/h; must trigger download_location and attribute.
- Wikimedia licenses vary per file (some NC/SA).

**Workarounds implemented**

- Client-side token buckets per provider.
- Assets are downloaded into job storage (no hotlinking).
- Unsplash download ping sent automatically; attribution recorded in vidsk.assets.json.
- licensedOnly briefs drop NC licenses.

## IMAGE

### gpt-image-1 · Imagen · FLUX (Workers AI / fal / Replicate)

- **id:** `image-gen` · **license:** OpenAI/Google outputs usable commercially per terms; FLUX schnell Apache-2.0; FLUX dev non-commercial · **source:** https://platform.openai.com/docs/guides/image-generation (checked 2026-10)
- **configure:** `VIDSK_IMAGE=openai|imagen|workers-ai|fal:<model>|replicate:<model>`

**Limits**

- gpt-image-1 sizes are fixed (1024², 1536×1024, 1024×1536).
- Imagen fixed aspect ratios; may filter prompts.
- Text rendering in images is unreliable.

**Workarounds implemented**

- Nearest supported size, then object-fit: cover crop into the 16:11 window.
- Prompts forbid text/logos; on-screen text is HTML (crisp, editable).
- FallbackImages chain; last resort is a styled placeholder card.

## VIDEO

### Text/image-to-video via fal or Replicate (Veo, Kling, Runway, Luma, LTX, Wan…)

- **id:** `video-gen` · **license:** per model · **source:** https://fal.ai/models (checked 2026-10)
- **configure:** `VIDSK_VIDEO=fal:<model>|replicate:<model>`, `VIDSK_VIDEO_INPUT (JSON template)`

**Limits**

- Clips are 4–10 s.
- Minutes of queue latency and high cost per second.
- Prompt adherence is loose; artifacts on hands/text.

**Workarounds implemented**

- Used only for b-roll the stock search can't satisfy; capped at maxDurationSec and cut to the anchor-word slot.
- Async polling with backoff and a 20 min deadline.

## RESEARCH

### Tavily · Exa · Brave · SearXNG · Wikipedia · Jina Reader

- **id:** `research` · **license:** per API · **source:** https://docs.tavily.com/ (checked 2026-10)
- **configure:** `VIDSK_RESEARCH=tavily,exa,brave,searxng,wikipedia`, `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`, `SEARXNG_URL`, `JINA_API_KEY`

**Limits**

- Search snippets are short; pages need a reader.
- Some sites block bots; JS-heavy pages return little text.

**Workarounds implemented**

- Top results are read through r.jina.ai with a plain fetch→text fallback.
- Wikipedia is a free, keyless baseline.
- Claims carry confidence; low-confidence claims can't carry the story (QA flags them).

## RENDER

### HyperFrames (HTML → MP4, headless Chrome + FFmpeg)

- **id:** `hyperframes` · **license:** Apache-2.0 · **source:** https://hyperframes.heygen.com (checked 2026-10)
- **configure:** `VIDSK_RENDER=local|http:<url>|container`, `RENDER_TOKEN`

**Limits**

- Needs Chrome + FFmpeg: cannot run inside a Worker isolate.
- Determinism rules: no Date.now / Math.random / timers / infinite repeats; fromTo tweens; never animate a .clip itself.
- Each Chrome worker ≈ 256 MB; low-memory hosts need PRODUCER_LOW_MEMORY_MODE.
- Fonts outside the bundled set need @font-face files.

**Workarounds implemented**

- Workers compile the project; rendering runs in a Cloudflare Container (or any Node host) via HttpRenderBackend.
- Compiler emits seeded/deterministic timelines, fromTo only, immediateRender:false on repeated tweens, and passes `hyperframes check` with zero errors.
- GSAP vendored into the project at render time (no CDN at capture).
- Pre-blurred low-res fills generated with ffmpeg instead of CSS blur on footage.

## PUBLISHING PLATFORMS

| Platform | Duration | Max size | Caption limit | Notes |
| --- | --- | --- | --- | --- |
| YouTube Shorts | 1–180 s | 262144 MB | 5000 chars | Uploads from unverified (un-audited) API projects are forced to private; request an audit to publish publicly. videos.insert draws from a dedicated upload quota bucket; check the project's quota page, values changed in 2025–2026. Vertical or square and ≤ 3 min is classified as a Short automatically; #Shorts in title/description is optional. Captions: upload SRT via captions.insert after the video is processed. ([source](https://developers.google.com/youtube/v3/docs/videos/insert), 2026-10) |
| YouTube | 1–43200 s | 262144 MB | 5000 chars | Unverified channels are limited to 15 minutes per video. Same audit/quota constraints as Shorts. ([source](https://developers.google.com/youtube/v3/docs/videos/insert), 2026-10) |
| TikTok | 3–600 s | 4096 MB | 2200 utf16 | Unaudited apps can only post SELF_ONLY (private); pass the Content Posting API audit for public posts. Query creator_info first: privacy_level options and max_video_post_duration_sec are per creator. FILE_UPLOAD chunks: 5–64 MB each (final chunk ≤ 128 MB), ≤ 1000 chunks, sequential; files < 5 MB go in one chunk. PULL_FROM_URL requires a verified domain/URL prefix and no redirects. Init endpoint: 6 requests/minute per user token; access tokens expire in 24 h (refresh). Set is_aigc=true for AI-generated content. ([source](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post), 2026-10) |
| Instagram Reels | 3–900 s | 1024 MB | 2200 chars | Requires an Instagram professional account and the content_publish permission. Media must be at a public URL (video_url) or sent via the resumable rupload protocol. Publishing is rate limited per account per rolling 24 h; check content_publishing_limit before publishing. Poll the container status_code until FINISHED before media_publish. ([source](https://developers.facebook.com/docs/instagram-platform/content-publishing), 2026-10) |
| Facebook Reels | 3–90 s | 1024 MB | 2200 chars | Page-only (Page access token). Three phases: start → upload to rupload.facebook.com → finish with video_state. Longer vertical videos can be posted as regular Page videos instead of Reels. ([source](https://developers.facebook.com/docs/video-api/guides/reels-publishing), 2026-10) |
| X | 0.5–1200 s | 8192 MB | 280 chars | Use /2/media/upload/initialize → /{id}/append (≤ 5 MB segments recommended, 8 MB max) → /{id}/finalize, then poll STATUS. Premium accounts allow 125 min / 16 GB; default 20 min / 8 GB per X docs (tweet_video). API access tier and per-endpoint caps apply; budget media calls. Long text needs Premium; otherwise 280 weighted chars (URLs count 23). ([source](https://docs.x.com/x-api/media/quickstart/media-upload-chunked), 2026-10) |
| LinkedIn | 3–1800 s | 5120 MB | 3000 chars | Videos API: initializeUpload → PUT each part to uploadInstructions → finalizeUpload with ETags → Posts API. Requires w_member_social (member) or w_organization_social (page) and a LinkedIn-Version header. ([source](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api), 2026-10) |
| Threads | 1–300 s | 1024 MB | 500 chars | Video must be at a public URL; create container → poll status → threads_publish. ([source](https://developers.facebook.com/docs/threads/posts), 2026-10) |
| Pinterest | 4–900 s | 2048 MB | 800 chars | Register media (POST /v5/media) → upload to the returned S3 URL → poll → create pin with media_source video_id and a cover image. ([source](https://developers.pinterest.com/docs/api/v5/), 2026-10) |
| Bluesky | 1–180 s | 100 MB | 300 graphemes | Upload via the video service (app.bsky.video.uploadVideo) with a service-auth token, poll job status, then post an app.bsky.embed.video record. Daily upload caps apply per account. ([source](https://docs.bsky.app/docs/tutorials/video), 2026-10) |
