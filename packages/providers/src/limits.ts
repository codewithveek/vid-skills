/**
 * Provider limits & workarounds registry.
 *
 * Single source of truth for what each model/tool can't do and how this repo
 * works around it. It is exported to agents (MCP resource `vidsk://providers/limits`),
 * rendered into docs/provider-limits.md, and checked by tests. Numbers drift:
 * each entry carries `source` + `verifiedAt`; adapters read capabilities at
 * runtime and env overrides win.
 */
export interface ProviderLimit {
  id: string;
  kind: "llm" | "tts" | "stt" | "music" | "sfx" | "stock" | "image" | "video" | "research" | "render" | "publish";
  name: string;
  license: string;
  limits: string[];
  workarounds: string[];
  env: string[];
  source: string;
  verifiedAt: string;
}

export const PROVIDER_LIMITS: ProviderLimit[] = [
  /* ---------------- LLMs ---------------- */
  {
    id: "openai-compatible",
    kind: "llm",
    name: "Any OpenAI-compatible chat API (OpenAI, OpenRouter, Groq, Together, DeepSeek, Mistral, xAI, Ollama, LM Studio, vLLM, llama.cpp)",
    license: "per provider / model",
    limits: [
      "Dialects differ: reasoning models reject `max_tokens`/`temperature`; many local servers ignore `response_format: json_schema`.",
      "Small local models (≤ 8B) frequently emit prose around JSON, trailing commas, or truncated objects.",
      "Context windows vary from 4k (local) to 1M tokens.",
      "Rate limits surface as 429 with Retry-After or x-ratelimit-reset-* headers.",
    ],
    workarounds: [
      "Adaptive dialect: on a 400 naming max_tokens / temperature / response_format, the adapter switches param or drops it and retries.",
      "generateStructured(): schema-in-prompt + example, tolerant JSON extraction, zod validation with path-precise repair loop (≤ 3 rounds), and continuation on finish_reason=length.",
      "Context fitting trims the longest non-system message from the middle to fit `contextTokens`.",
      "Deterministic fallbacks: storyboard falls back to a rule-based shot list; timing never depends on the model.",
      "FallbackLLM chain with circuit breaker; capabilities are the intersection of the chain.",
    ],
    env: ["VIDSK_LLM=openai:<model>|openrouter:<model>|groq:<model>|ollama:<model>|compat:<baseUrl>#<model>", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENROUTER_API_KEY", "GROQ_API_KEY", "OLLAMA_BASE_URL"],
    source: "https://platform.openai.com/docs/api-reference/chat",
    verifiedAt: "2026-10",
  },
  {
    id: "anthropic",
    kind: "llm",
    name: "Anthropic Messages API (Claude)",
    license: "commercial API",
    limits: ["System prompt is a top-level field; consecutive same-role turns are rejected.", "No generic JSON mode in the classic Messages API path used here.", "Long outputs stop with stop_reason=max_tokens."],
    workarounds: ["Adapter extracts system messages and merges consecutive turns.", "Structured output via generateStructured (schema-in-prompt + validation + repair).", "Continuation on max_tokens."],
    env: ["VIDSK_LLM=anthropic:<model>", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
    source: "https://docs.anthropic.com/en/api/messages",
    verifiedAt: "2026-10",
  },
  {
    id: "gemini",
    kind: "llm",
    name: "Google Gemini (generateContent)",
    license: "commercial API",
    limits: ["Roles are user/model; system goes to systemInstruction.", "Thinking models may return thought parts.", "SAFETY finish reasons return empty text."],
    workarounds: ["Role mapping + thought-part filtering.", "responseMimeType=application/json when JSON is requested.", "SAFETY → treated as failure so FallbackLLM moves on."],
    env: ["VIDSK_LLM=gemini:<model>", "GEMINI_API_KEY"],
    source: "https://ai.google.dev/api/generate-content",
    verifiedAt: "2026-10",
  },
  {
    id: "workers-ai",
    kind: "llm",
    name: "Cloudflare Workers AI (binding env.AI or REST)",
    license: "per model",
    limits: ["Smaller open models; output token caps around 2–4k by default.", "Response shape varies by model (response string vs object)."],
    workarounds: ["Use as llmFast (copy, review) and keep a stronger primary.", "Shape normalisation in the adapter."],
    env: ["VIDSK_LLM=workers-ai:@cf/<model>", "CF_ACCOUNT_ID", "CF_API_TOKEN (outside Workers)"],
    source: "https://developers.cloudflare.com/workers-ai/models/",
    verifiedAt: "2026-10",
  },
  /* ---------------- TTS ---------------- */
  {
    id: "kokoro",
    kind: "tts",
    name: "Kokoro-82M (open weights, via Kokoro-FastAPI or `hyperframes tts`)",
    license: "Apache-2.0",
    limits: ["~510 phoneme tokens per inference pass; long text must be split.", "Reads 4-digit years as cardinals (1868 → \"one thousand eight hundred sixty-eight\").", "No voice cloning; fixed voice set (af_*, am_*, bf_*, bm_*, …).", "No delivery instructions/emotion control.", "Word timestamps only via Kokoro-FastAPI /dev/captioned_speech."],
    workarounds: ["Pipeline chunks by beat under 1,000 chars.", "core/speech.ts spells out years, decades, money, percents, decimals and ordinals before TTS for every provider (brief.voice.normalizeNumbers), then folds word timings back so captions keep the digits.", "Adapter uses captioned_speech for word timings, auto-falls back to /v1/audio/speech + STT/estimated alignment.", "speed 1.05–1.12 matches the reference's ~170 wpm delivery.", "Runs on CPU in a container next to the renderer, so a fully open-source, zero-API pipeline is possible."],
    env: ["VIDSK_TTS=kokoro:<voice>", "KOKORO_BASE_URL (default http://localhost:8880)"],
    source: "https://huggingface.co/hexgrad/Kokoro-82M",
    verifiedAt: "2026-10",
  },
  {
    id: "elevenlabs",
    kind: "tts",
    name: "ElevenLabs TTS (with-timestamps)",
    license: "commercial (per plan)",
    limits: ["Per-request character caps differ by model (≈5k v3, 10k multilingual_v2, 40k flash/turbo v2.5).", "eleven_v3 doesn't support previous_text/next_text stitching; it uses inline audio tags instead of instructions.", "Concurrency limits per plan → 429.", "PCM output formats may require higher tiers."],
    workarounds: ["Capabilities derived from the model id; pipeline chunks below the cap.", "previous_text/next_text sent for prosody continuity on models that support it.", "Character alignment converted to word timings (no STT needed).", "MP3 default (frame-scanned duration, no decode needed on Workers)."],
    env: ["VIDSK_TTS=elevenlabs:<voiceId>@<model>", "ELEVENLABS_API_KEY"],
    source: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps",
    verifiedAt: "2026-10",
  },
  {
    id: "openai-tts",
    kind: "tts",
    name: "OpenAI TTS (gpt-4o-mini-tts, tts-1) and any OpenAI-compatible /audio/speech server",
    license: "commercial (disclose AI voice)",
    limits: ["4,096 characters per request.", "No timestamps.", "`instructions` only on gpt-4o*-tts models."],
    workarounds: ["Chunking; word timings from STT (if configured) or syllable-weighted estimation (±120 ms).", "Delivery direction passed as instructions when supported."],
    env: ["VIDSK_TTS=openai:<voice>@<model>", "OPENAI_API_KEY"],
    source: "https://platform.openai.com/docs/guides/text-to-speech",
    verifiedAt: "2026-10",
  },
  {
    id: "cartesia",
    kind: "tts",
    name: "Cartesia Sonic",
    license: "commercial",
    limits: ["Word timestamps only on streaming transports (SSE/WebSocket)."],
    workarounds: ["Adapter consumes SSE with add_timestamps and reassembles raw PCM into WAV."],
    env: ["VIDSK_TTS=cartesia:<voiceId>@<model>", "CARTESIA_API_KEY"],
    source: "https://docs.cartesia.ai/",
    verifiedAt: "2026-10",
  },
  {
    id: "google-tts",
    kind: "tts",
    name: "Google Cloud Text-to-Speech",
    license: "commercial",
    limits: ["5,000-byte input limit including SSML markup.", "Timestamps only for SSML <mark> tags (v1beta1)."],
    workarounds: ["Inserts a <mark> before every word → word start times; caps chunks at 1,500 chars."],
    env: ["VIDSK_TTS=google:<voiceName>", "GOOGLE_TTS_API_KEY"],
    source: "https://cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize",
    verifiedAt: "2026-10",
  },
  {
    id: "azure-tts",
    kind: "tts",
    name: "Azure AI Speech (REST)",
    license: "commercial",
    limits: ["Word-boundary events only through the SDK/WebSocket, not REST.", "~10 minutes of audio per request."],
    workarounds: ["STT or estimated alignment; SSML prosody for speed; mstts:express-as for style."],
    env: ["VIDSK_TTS=azure:<voiceName>", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
    source: "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech",
    verifiedAt: "2026-10",
  },
  {
    id: "deepgram-tts",
    kind: "tts",
    name: "Deepgram Aura",
    license: "commercial",
    limits: ["2,000 characters per request.", "No timestamps."],
    workarounds: ["Chunking + STT/estimated alignment."],
    env: ["VIDSK_TTS=deepgram:<model>", "DEEPGRAM_API_KEY"],
    source: "https://developers.deepgram.com/docs/text-to-speech",
    verifiedAt: "2026-10",
  },
  /* ---------------- STT ---------------- */
  {
    id: "whisper",
    kind: "stt",
    name: "Whisper (OpenAI whisper-1, Groq whisper-large-v3-turbo, faster-whisper servers, Workers AI)",
    license: "MIT weights / commercial APIs",
    limits: ["25 MB per request on OpenAI/Groq.", "Hallucinates phrases (\"Thanks for watching!\") over silence/music — observed in the reference audit.", "gpt-4o-transcribe models don't return word timestamps."],
    workarounds: ["Only short voice chunks are sent; oversize input falls back to estimation.", "guardHallucinations() drops words in silent regions and low-confidence outro phrases.", "Script text passed as `prompt` to bias spelling."],
    env: ["VIDSK_STT=openai|groq|deepgram|elevenlabs|workers-ai|compat:<baseUrl>#<model>"],
    source: "https://platform.openai.com/docs/api-reference/audio/createTranscription",
    verifiedAt: "2026-10",
  },
  /* ---------------- Music / SFX ---------------- */
  {
    id: "elevenlabs-music",
    kind: "music",
    name: "ElevenLabs Music",
    license: "commercial (cleared per plan terms)",
    limits: ["Track length bounded (≈10 s – 5 min).", "Prompts naming copyrighted artists/songs are rejected."],
    workarounds: ["Prompt by feel/tempo, not artist (\"minimal dark tech pulse, 118 bpm\").", "Shorter-than-video beds are looped with 1 s crossfades and clip-relative automation."],
    env: ["VIDSK_MUSIC=elevenlabs", "ELEVENLABS_API_KEY"],
    source: "https://elevenlabs.io/docs/api-reference/music/compose",
    verifiedAt: "2026-10",
  },
  {
    id: "stable-audio",
    kind: "music",
    name: "Stable Audio 2.x (Stability API)",
    license: "per Stability plan",
    limits: ["Max ~3 minutes per generation."],
    workarounds: ["Looping with crossfades for longer videos."],
    env: ["VIDSK_MUSIC=stability", "STABILITY_API_KEY"],
    source: "https://platform.stability.ai/docs/api-reference",
    verifiedAt: "2026-10",
  },
  {
    id: "hosted-music",
    kind: "music",
    name: "Open music models on fal/Replicate (MusicGen, ACE-Step, Stable Audio Open…)",
    license: "varies — MusicGen weights are CC-BY-NC (non-commercial); ACE-Step is Apache-2.0",
    limits: ["MusicGen ≈ 30 s per call and non-commercial weights.", "Async queues: minutes of latency under load."],
    workarounds: ["`commercialUse` flag per model; licensedOnly briefs refuse NC models.", "Loop + crossfade; queue polling with backoff."],
    env: ["VIDSK_MUSIC=fal:<model>|replicate:<model>", "FAL_KEY", "REPLICATE_API_TOKEN", "VIDSK_MUSIC_INPUT (JSON template)"],
    source: "https://fal.ai/models",
    verifiedAt: "2026-10",
  },
  {
    id: "sfx",
    kind: "sfx",
    name: "ElevenLabs SFX · Freesound · Openverse · procedural",
    license: "ElevenLabs royalty-free per plan; Freesound CC0 filter; Openverse commercial CC filter",
    limits: ["ElevenLabs SFX ≤ 30 s.", "Freesound needs a key; CC-BY requires attribution.", "Openverse anonymous rate limits."],
    workarounds: ["Fallback chain ends in deterministic procedural foley (whoosh, click, tick, pop, swipe, riser, impact) so no run ships silent actions.", "Two takes per cue, rotated (repeated identical SFX is the most common tell)."],
    env: ["VIDSK_SFX=elevenlabs,freesound,openverse", "FREESOUND_API_KEY"],
    source: "https://freesound.org/docs/api/",
    verifiedAt: "2026-10",
  },
  /* ---------------- Visuals ---------------- */
  {
    id: "stock",
    kind: "stock",
    name: "Pexels · Pixabay · Unsplash · Openverse · Wikimedia Commons",
    license: "Pexels/Pixabay licenses (commercial OK); Unsplash License (+ API attribution rules); CC per file",
    limits: ["Pexels 200 req/h, 20k/month.", "Pixabay ~100 req/min; results cached ≤ 24 h, no permanent hotlinking.", "Unsplash demo keys 50 req/h; must trigger download_location and attribute.", "Wikimedia licenses vary per file (some NC/SA)."],
    workarounds: ["Client-side token buckets per provider.", "Assets are downloaded into job storage (no hotlinking).", "Unsplash download ping sent automatically; attribution recorded in vidsk.assets.json.", "licensedOnly briefs drop NC licenses."],
    env: ["VIDSK_STOCK=pexels,pixabay,unsplash,openverse,wikimedia", "PEXELS_API_KEY", "PIXABAY_API_KEY", "UNSPLASH_ACCESS_KEY"],
    source: "https://www.pexels.com/api/documentation/",
    verifiedAt: "2026-10",
  },
  {
    id: "image-gen",
    kind: "image",
    name: "gpt-image-1 · Imagen · FLUX (Workers AI / fal / Replicate)",
    license: "OpenAI/Google outputs usable commercially per terms; FLUX schnell Apache-2.0; FLUX dev non-commercial",
    limits: ["gpt-image-1 sizes are fixed (1024², 1536×1024, 1024×1536).", "Imagen fixed aspect ratios; may filter prompts.", "Text rendering in images is unreliable."],
    workarounds: ["Nearest supported size, then object-fit: cover crop into the 16:11 window.", "Prompts forbid text/logos; on-screen text is HTML (crisp, editable).", "FallbackImages chain; last resort is a styled placeholder card."],
    env: ["VIDSK_IMAGE=openai|imagen|workers-ai|fal:<model>|replicate:<model>"],
    source: "https://platform.openai.com/docs/guides/image-generation",
    verifiedAt: "2026-10",
  },
  {
    id: "video-gen",
    kind: "video",
    name: "Text/image-to-video via fal or Replicate (Veo, Kling, Runway, Luma, LTX, Wan…)",
    license: "per model",
    limits: ["Clips are 4–10 s.", "Minutes of queue latency and high cost per second.", "Prompt adherence is loose; artifacts on hands/text."],
    workarounds: ["Used only for b-roll the stock search can't satisfy; capped at maxDurationSec and cut to the anchor-word slot.", "Async polling with backoff and a 20 min deadline."],
    env: ["VIDSK_VIDEO=fal:<model>|replicate:<model>", "VIDSK_VIDEO_INPUT (JSON template)"],
    source: "https://fal.ai/models",
    verifiedAt: "2026-10",
  },
  /* ---------------- Research ---------------- */
  {
    id: "research",
    kind: "research",
    name: "Tavily · Exa · Brave · SearXNG · Wikipedia · Jina Reader",
    license: "per API",
    limits: ["Search snippets are short; pages need a reader.", "Some sites block bots; JS-heavy pages return little text."],
    workarounds: ["Top results are read through r.jina.ai with a plain fetch→text fallback.", "Wikipedia is a free, keyless baseline.", "Claims carry confidence; low-confidence claims can't carry the story (QA flags them)."],
    env: ["VIDSK_RESEARCH=tavily,exa,brave,searxng,wikipedia", "TAVILY_API_KEY", "EXA_API_KEY", "BRAVE_API_KEY", "SEARXNG_URL", "JINA_API_KEY"],
    source: "https://docs.tavily.com/",
    verifiedAt: "2026-10",
  },
  /* ---------------- Rendering ---------------- */
  {
    id: "hyperframes",
    kind: "render",
    name: "HyperFrames (HTML → MP4, headless Chrome + FFmpeg)",
    license: "Apache-2.0",
    limits: ["Needs Chrome + FFmpeg: cannot run inside a Worker isolate.", "Determinism rules: no Date.now / Math.random / timers / infinite repeats; fromTo tweens; never animate a .clip itself.", "Each Chrome worker ≈ 256 MB; low-memory hosts need PRODUCER_LOW_MEMORY_MODE.", "Fonts outside the bundled set need @font-face files."],
    workarounds: ["Workers compile the project; rendering runs in a Cloudflare Container (or any Node host) via HttpRenderBackend.", "Compiler emits seeded/deterministic timelines, fromTo only, immediateRender:false on repeated tweens, and passes `hyperframes check` with zero errors.", "GSAP vendored into the project at render time (no CDN at capture).", "Pre-blurred low-res fills generated with ffmpeg instead of CSS blur on footage."],
    env: ["VIDSK_RENDER=local|http:<url>|container", "RENDER_TOKEN"],
    source: "https://hyperframes.heygen.com",
    verifiedAt: "2026-10",
  },
];

export function limitsFor(kind?: ProviderLimit["kind"]): ProviderLimit[] {
  return kind ? PROVIDER_LIMITS.filter((l) => l.kind === kind) : PROVIDER_LIMITS;
}

export function limitsMarkdown(): string {
  const kinds = [...new Set(PROVIDER_LIMITS.map((l) => l.kind))];
  let md = "# Provider limits and workarounds\n\n> Generated from `packages/providers/src/limits.ts` by `scripts/gen-limits-doc.ts`. Limits change; every entry lists its source and when it was checked. Adapters read capabilities at runtime and env overrides win.\n\n";
  for (const k of kinds) {
    md += `## ${k.toUpperCase()}\n\n`;
    for (const l of PROVIDER_LIMITS.filter((x) => x.kind === k)) {
      md += `### ${l.name}\n\n- **id:** \`${l.id}\` · **license:** ${l.license} · **source:** ${l.source} (checked ${l.verifiedAt})\n- **configure:** ${l.env.map((e) => `\`${e}\``).join(", ")}\n\n**Limits**\n\n${l.limits.map((x) => `- ${x}`).join("\n")}\n\n**Workarounds implemented**\n\n${l.workarounds.map((x) => `- ${x}`).join("\n")}\n\n`;
    }
  }
  return md;
}
