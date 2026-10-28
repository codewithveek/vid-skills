/**
 * Build a ProviderSet from environment variables (works the same in Node,
 * Workers, Docker, CI). Every slot accepts a comma-separated failover chain of
 * `provider[:arg][@model]` specs, e.g.
 *
 *   VIDSK_LLM="anthropic:claude-sonnet-5-5,openai:gpt-5,ollama:llama3.1"
 *   VIDSK_TTS="elevenlabs:<voiceId>@eleven_multilingual_v2,kokoro:am_michael"
 *   VIDSK_MUSIC="elevenlabs"        VIDSK_SFX="elevenlabs,freesound,openverse"
 *   VIDSK_STOCK="pexels,pixabay,openverse,wikimedia"
 *   VIDSK_IMAGE="workers-ai,openai"  VIDSK_RESEARCH="tavily,wikipedia"
 *   VIDSK_RENDER="http:https://render.example.com"
 *
 * Unset slots are auto-detected from whichever API keys are present.
 */
import type { ImageProvider, LLMProvider, MusicProvider, ProviderSet, ResearchProvider, SfxProvider, StockProvider, STTProvider, TTSProvider, VideoGenProvider } from "@vid-skills/core";
import { ElevenLabsMusic, ElevenLabsSfx, ElevenLabsSTT, FallbackSfx, FreesoundSfx, HostedMusic, OpenverseSfx, ProceduralSfx, StableAudioMusic, WhisperSTT, DeepgramSTT, WorkersAiSTT } from "./audio.js";
import type { HostedModel } from "./hosted.js";
import { AnthropicLLM, FallbackLLM, GeminiLLM, OpenAICompatibleLLM, WorkersAiLLM, type AiBinding } from "./llm.js";
import { HttpRenderBackend } from "./render-http.js";
import { BraveResearch, ExaResearch, SearxngResearch, TavilyResearch, WikipediaResearch, readWithJina, withReader } from "./research.js";
import { AzureTTS, CartesiaTTS, DeepgramTTS, DryRunTTS, ElevenLabsTTS, FallbackTTS, GoogleTTS, KokoroTTS, OpenAITTS, WorkersAiTTS } from "./tts.js";
import { FallbackImages, GeminiImages, HostedImages, HostedVideo, OpenAIImages, OpenverseStock, PexelsStock, PixabayStock, UnsplashStock, WikimediaStock, WorkersAiImages } from "./visuals.js";

export type Env = Record<string, string | undefined>;

export interface Spec {
  provider: string;
  arg?: string;
  model?: string;
}

/** "elevenlabs:VOICE@model", "compat:https://host/v1#model", "openai:gpt-5" */
export function parseSpecs(s: string | undefined): Spec[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(":");
      const provider = (i < 0 ? x : x.slice(0, i)).toLowerCase();
      let rest = i < 0 ? "" : x.slice(i + 1);
      let model: string | undefined;
      const hash = rest.lastIndexOf("#");
      if (hash >= 0) {
        model = rest.slice(hash + 1);
        rest = rest.slice(0, hash);
      } else if (!/^https?:/.test(rest)) {
        const at = rest.lastIndexOf("@");
        if (at > 0) {
          model = rest.slice(at + 1);
          rest = rest.slice(0, at);
        }
      }
      return { provider, arg: rest || undefined, model };
    });
}

export class ConfigError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "ConfigError";
  }
}

const need = (env: Env, k: string): string => {
  const v = env[k];
  if (!v) throw new ConfigError(`missing env ${k}`);
  return v;
};

const COMPAT_BASES: Record<string, { url: string; key?: string; base?: string }> = {
  openai: { url: "https://api.openai.com/v1", key: "OPENAI_API_KEY", base: "OPENAI_BASE_URL" },
  openrouter: { url: "https://openrouter.ai/api/v1", key: "OPENROUTER_API_KEY" },
  groq: { url: "https://api.groq.com/openai/v1", key: "GROQ_API_KEY" },
  together: { url: "https://api.together.xyz/v1", key: "TOGETHER_API_KEY" },
  deepseek: { url: "https://api.deepseek.com/v1", key: "DEEPSEEK_API_KEY" },
  mistral: { url: "https://api.mistral.ai/v1", key: "MISTRAL_API_KEY" },
  xai: { url: "https://api.x.ai/v1", key: "XAI_API_KEY" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1", key: "FIREWORKS_API_KEY" },
  cerebras: { url: "https://api.cerebras.ai/v1", key: "CEREBRAS_API_KEY" },
  ollama: { url: "http://localhost:11434/v1", base: "OLLAMA_BASE_URL" },
  lmstudio: { url: "http://localhost:1234/v1", base: "LMSTUDIO_BASE_URL" },
  vllm: { url: "http://localhost:8000/v1", base: "VLLM_BASE_URL", key: "VLLM_API_KEY" },
};

const LOCAL = new Set(["ollama", "lmstudio", "vllm"]);

export interface FactoryOptions {
  ai?: AiBinding;
  /** host-provided extras/overrides (e.g. local Kokoro via CLI, Container render backend) */
  overrides?: Partial<ProviderSet>;
}

function llmFrom(spec: Spec, env: Env, o: FactoryOptions): LLMProvider {
  const p = spec.provider;
  const model = spec.model ?? spec.arg;
  if (p === "anthropic") return new AnthropicLLM({ apiKey: need(env, "ANTHROPIC_API_KEY"), model: model ?? "claude-sonnet-5-5", baseUrl: env.ANTHROPIC_BASE_URL });
  if (p === "gemini" || p === "google") return new GeminiLLM({ apiKey: need(env, "GEMINI_API_KEY"), model: model ?? "gemini-2.5-pro" });
  if (p === "workers-ai") return new WorkersAiLLM({ model: model ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast", binding: o.ai, accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
  if (p === "compat") {
    if (!spec.arg) throw new ConfigError("compat LLM needs a base URL: compat:https://host/v1#model");
    return new OpenAICompatibleLLM({ id: "compat", baseUrl: spec.arg, apiKey: env.COMPAT_API_KEY, model: spec.model ?? "default", capabilities: { jsonSchema: false } });
  }
  const c = COMPAT_BASES[p];
  if (!c) throw new ConfigError(`unknown LLM provider "${p}"`);
  const baseUrl = (c.base && env[c.base]) || c.url;
  const apiKey = c.key ? env[c.key] : undefined;
  if (c.key && !apiKey && !LOCAL.has(p)) throw new ConfigError(`missing env ${c.key}`);
  return new OpenAICompatibleLLM({
    id: p,
    baseUrl: baseUrl.endsWith("/v1") || baseUrl.includes("/v1") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/v1`,
    apiKey,
    model: model ?? (p === "openai" ? "gpt-5" : p === "groq" ? "llama-3.3-70b-versatile" : p === "openrouter" ? "openrouter/auto" : "llama3.1"),
    maxTokensParam: p === "openai" ? "max_completion_tokens" : "max_tokens",
    headers: p === "openrouter" ? { "HTTP-Referer": "https://github.com/codewithveek/vid-skills", "X-Title": "vid-skills" } : undefined,
    capabilities: {
      jsonSchema: p === "openai",
      jsonMode: true,
      contextTokens: LOCAL.has(p) ? Number(env.VIDSK_LOCAL_CONTEXT ?? 16_000) : 128_000,
      maxOutputTokens: LOCAL.has(p) ? 4096 : 16_000,
    },
  });
}

function autoLLM(env: Env, o: FactoryOptions, fast: boolean): string | undefined {
  if (env.ANTHROPIC_API_KEY) return fast ? "anthropic:claude-haiku-5-5" : "anthropic:claude-sonnet-5-5";
  if (env.OPENAI_API_KEY) return fast ? "openai:gpt-5-mini" : "openai:gpt-5";
  if (env.GEMINI_API_KEY) return fast ? "gemini:gemini-2.5-flash" : "gemini:gemini-2.5-pro";
  if (env.OPENROUTER_API_KEY) return "openrouter:openrouter/auto";
  if (env.GROQ_API_KEY) return "groq:llama-3.3-70b-versatile";
  if (o.ai || (env.CF_ACCOUNT_ID && env.CF_API_TOKEN)) return "workers-ai:@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  if (env.OLLAMA_BASE_URL) return "ollama:llama3.1";
  return undefined;
}

function chainLLM(specs: Spec[], env: Env, o: FactoryOptions): LLMProvider {
  const list = specs.map((s) => llmFrom(s, env, o));
  return list.length === 1 ? list[0]! : new FallbackLLM(list);
}

function ttsFrom(s: Spec, env: Env, o: FactoryOptions): TTSProvider {
  switch (s.provider) {
    case "elevenlabs":
      return new ElevenLabsTTS({ apiKey: need(env, "ELEVENLABS_API_KEY"), voiceId: s.arg ?? need(env, "ELEVENLABS_VOICE_ID"), model: s.model ?? env.ELEVENLABS_TTS_MODEL });
    case "kokoro":
      return new KokoroTTS({ baseUrl: env.KOKORO_BASE_URL ?? "http://localhost:8880", voice: s.arg ?? "am_michael", apiKey: env.KOKORO_API_KEY });
    case "openai":
      return new OpenAITTS({ apiKey: need(env, "OPENAI_API_KEY"), baseUrl: env.OPENAI_BASE_URL, voice: s.arg ?? "onyx", model: s.model });
    case "compat":
      return new OpenAITTS({ id: "compat-tts", baseUrl: s.arg ?? need(env, "TTS_BASE_URL"), apiKey: env.TTS_API_KEY, model: s.model ?? "tts-1", voice: env.TTS_VOICE, maxChars: 1000, local: true, license: { name: "per model (verify)", commercialUse: true, requiresAttribution: false } });
    case "cartesia":
      return new CartesiaTTS({ apiKey: need(env, "CARTESIA_API_KEY"), voiceId: s.arg ?? need(env, "CARTESIA_VOICE_ID"), model: s.model });
    case "google":
      return new GoogleTTS({ apiKey: need(env, "GOOGLE_TTS_API_KEY"), voice: s.arg });
    case "azure":
      return new AzureTTS({ apiKey: need(env, "AZURE_SPEECH_KEY"), region: need(env, "AZURE_SPEECH_REGION"), voice: s.arg });
    case "deepgram":
      return new DeepgramTTS({ apiKey: need(env, "DEEPGRAM_API_KEY"), model: s.arg });
    case "workers-ai":
      return new WorkersAiTTS({ model: s.model ?? s.arg, binding: o.ai, accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
    case "dry-run":
      return new DryRunTTS();
    default:
      throw new ConfigError(`unknown TTS provider "${s.provider}"`);
  }
}

function autoTTS(env: Env, o: FactoryOptions): string | undefined {
  if (env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID) return "elevenlabs";
  if (env.KOKORO_BASE_URL) return "kokoro";
  if (env.CARTESIA_API_KEY && env.CARTESIA_VOICE_ID) return "cartesia";
  if (env.OPENAI_API_KEY) return "openai";
  if (o.ai) return "workers-ai";
  return undefined;
}

function sttFrom(s: Spec, env: Env, o: FactoryOptions): STTProvider {
  switch (s.provider) {
    case "openai":
      return new WhisperSTT({ apiKey: need(env, "OPENAI_API_KEY"), model: s.model ?? "whisper-1" });
    case "groq":
      return new WhisperSTT({ id: "groq-whisper", apiKey: need(env, "GROQ_API_KEY"), baseUrl: "https://api.groq.com/openai/v1", model: s.model ?? "whisper-large-v3-turbo" });
    case "compat":
      return new WhisperSTT({ id: "compat-stt", baseUrl: s.arg ?? need(env, "STT_BASE_URL"), apiKey: env.STT_API_KEY, model: s.model ?? "Systran/faster-whisper-small" });
    case "deepgram":
      return new DeepgramSTT({ apiKey: need(env, "DEEPGRAM_API_KEY"), model: s.model });
    case "elevenlabs":
      return new ElevenLabsSTT({ apiKey: need(env, "ELEVENLABS_API_KEY") });
    case "workers-ai":
      return new WorkersAiSTT({ model: s.model ?? s.arg, binding: o.ai, accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
    default:
      throw new ConfigError(`unknown STT provider "${s.provider}"`);
  }
}

function hosted(s: Spec, env: Env, inputVar: string, def: Record<string, unknown>): HostedModel {
  const host = s.provider as "fal" | "replicate";
  const apiKey = host === "fal" ? need(env, "FAL_KEY") : need(env, "REPLICATE_API_TOKEN");
  const model = [s.arg, s.model].filter(Boolean).join(s.arg && s.model ? "@" : "");
  if (!model) throw new ConfigError(`${host} needs a model: ${host}:<owner/model>`);
  return { host, model, apiKey, input: env[inputVar] ? (JSON.parse(env[inputVar]!) as Record<string, unknown>) : def };
}

export function providersFromEnv(env: Env, o: FactoryOptions = {}): ProviderSet {
  const llmSpecs = parseSpecs(env.VIDSK_LLM ?? autoLLM(env, o, false));
  if (!llmSpecs.length && !o.overrides?.llm) throw new ConfigError("no LLM configured: set VIDSK_LLM or an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, OLLAMA_BASE_URL…)");
  const llm = o.overrides?.llm ?? chainLLM(llmSpecs, env, o);
  const fastSpecs = parseSpecs(env.VIDSK_LLM_FAST ?? autoLLM(env, o, true));
  const llmFast = o.overrides?.llmFast ?? (fastSpecs.length ? chainLLM(fastSpecs, env, o) : undefined);

  const ttsSpecs = parseSpecs(env.VIDSK_TTS ?? autoTTS(env, o));
  let tts: TTSProvider | undefined = o.overrides?.tts;
  if (!tts) {
    if (!ttsSpecs.length) throw new ConfigError("no TTS configured: set VIDSK_TTS (kokoro, elevenlabs, openai, cartesia, google, azure, deepgram, workers-ai) or run the CLI which can use local Kokoro");
    const list = ttsSpecs.map((s) => ttsFrom(s, env, o));
    tts = list.length === 1 ? list[0]! : new FallbackTTS(list);
  }

  const sttSpec = parseSpecs(env.VIDSK_STT ?? (env.GROQ_API_KEY ? "groq" : env.OPENAI_API_KEY ? "openai" : env.DEEPGRAM_API_KEY ? "deepgram" : o.ai ? "workers-ai" : undefined))[0];
  const stt = o.overrides?.stt ?? (sttSpec ? sttFrom(sttSpec, env, o) : undefined);

  let music: MusicProvider | undefined = o.overrides?.music;
  const musicSpec = parseSpecs(env.VIDSK_MUSIC ?? (env.ELEVENLABS_API_KEY ? "elevenlabs" : env.STABILITY_API_KEY ? "stability" : undefined))[0];
  if (!music && musicSpec && musicSpec.provider !== "none") {
    if (musicSpec.provider === "elevenlabs") music = new ElevenLabsMusic({ apiKey: need(env, "ELEVENLABS_API_KEY") });
    else if (musicSpec.provider === "stability") music = new StableAudioMusic({ apiKey: need(env, "STABILITY_API_KEY"), model: musicSpec.model });
    else if (musicSpec.provider === "fal" || musicSpec.provider === "replicate")
      music = new HostedMusic(hosted(musicSpec, env, "VIDSK_MUSIC_INPUT", { prompt: "{{prompt}}", duration: "{{duration}}" }), Number(env.VIDSK_MUSIC_MAX_SEC ?? 30), env.VIDSK_MUSIC_COMMERCIAL === "true");
    else throw new ConfigError(`unknown music provider "${musicSpec.provider}"`);
  }

  let sfx: SfxProvider | undefined = o.overrides?.sfx;
  if (!sfx) {
    const specs = parseSpecs(env.VIDSK_SFX ?? [env.ELEVENLABS_API_KEY ? "elevenlabs" : "", env.FREESOUND_API_KEY ? "freesound" : "", "openverse"].filter(Boolean).join(","));
    const list: SfxProvider[] = specs.flatMap((s): SfxProvider[] => {
      if (s.provider === "elevenlabs") return [new ElevenLabsSfx({ apiKey: need(env, "ELEVENLABS_API_KEY") })];
      if (s.provider === "freesound") return [new FreesoundSfx({ apiKey: need(env, "FREESOUND_API_KEY") })];
      if (s.provider === "openverse") return [new OpenverseSfx()];
      if (s.provider === "procedural") return [new ProceduralSfx()];
      throw new ConfigError(`unknown SFX provider "${s.provider}"`);
    });
    sfx = new FallbackSfx(list);
  }

  const stock: StockProvider[] =
    o.overrides?.stock ??
    parseSpecs(env.VIDSK_STOCK ?? [env.PEXELS_API_KEY ? "pexels" : "", env.PIXABAY_API_KEY ? "pixabay" : "", env.UNSPLASH_ACCESS_KEY ? "unsplash" : "", "openverse", "wikimedia"].filter(Boolean).join(",")).map((s) => {
      switch (s.provider) {
        case "pexels":
          return new PexelsStock({ apiKey: need(env, "PEXELS_API_KEY") });
        case "pixabay":
          return new PixabayStock({ apiKey: need(env, "PIXABAY_API_KEY") });
        case "unsplash":
          return new UnsplashStock({ accessKey: need(env, "UNSPLASH_ACCESS_KEY") });
        case "openverse":
          return new OpenverseStock();
        case "wikimedia":
          return new WikimediaStock();
        default:
          throw new ConfigError(`unknown stock provider "${s.provider}"`);
      }
    });

  let image: ImageProvider | undefined = o.overrides?.image;
  if (!image) {
    const specs = parseSpecs(env.VIDSK_IMAGE ?? [o.ai ? "workers-ai" : "", env.OPENAI_API_KEY ? "openai" : "", env.GEMINI_API_KEY ? "imagen" : ""].filter(Boolean).join(","));
    const list: ImageProvider[] = specs.map((s) => {
      if (s.provider === "openai") return new OpenAIImages({ apiKey: need(env, "OPENAI_API_KEY"), model: s.model ?? s.arg });
      if (s.provider === "imagen") return new GeminiImages({ apiKey: need(env, "GEMINI_API_KEY"), model: s.model ?? s.arg });
      if (s.provider === "workers-ai") return new WorkersAiImages({ model: s.model ?? s.arg, binding: o.ai, accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
      if (s.provider === "fal" || s.provider === "replicate") return new HostedImages(hosted(s, env, "VIDSK_IMAGE_INPUT", { prompt: "{{prompt}}", image_size: "landscape_16_9" }), env.VIDSK_IMAGE_COMMERCIAL !== "false");
      throw new ConfigError(`unknown image provider "${s.provider}"`);
    });
    image = list.length > 1 ? new FallbackImages(list) : list[0];
  }

  let video: VideoGenProvider | undefined = o.overrides?.video;
  const vs = parseSpecs(env.VIDSK_VIDEO)[0];
  if (!video && vs) video = new HostedVideo(hosted(vs, env, "VIDSK_VIDEO_INPUT", { prompt: "{{prompt}}", duration: "{{duration}}", aspect_ratio: "{{aspect}}" }), Number(env.VIDSK_VIDEO_MAX_SEC ?? 5));

  const research: ResearchProvider[] =
    o.overrides?.research ??
    parseSpecs(env.VIDSK_RESEARCH ?? [env.TAVILY_API_KEY ? "tavily" : "", env.EXA_API_KEY ? "exa" : "", env.BRAVE_API_KEY ? "brave" : "", env.SEARXNG_URL ? "searxng" : "", "wikipedia"].filter(Boolean).join(",")).map((s) => {
      const reader = readWithJina(env.JINA_API_KEY);
      switch (s.provider) {
        case "tavily":
          return withReader(new TavilyResearch({ apiKey: need(env, "TAVILY_API_KEY") }), reader);
        case "exa":
          return withReader(new ExaResearch({ apiKey: need(env, "EXA_API_KEY") }), reader);
        case "brave":
          return new BraveResearch({ apiKey: need(env, "BRAVE_API_KEY") });
        case "searxng":
          return new SearxngResearch({ baseUrl: s.arg ?? need(env, "SEARXNG_URL") });
        case "wikipedia":
          return withReader(new WikipediaResearch({ lang: s.arg }), reader);
        case "none":
          return null as unknown as ResearchProvider;
        default:
          throw new ConfigError(`unknown research provider "${s.provider}"`);
      }
    }).filter(Boolean);

  const rs = parseSpecs(env.VIDSK_RENDER)[0];
  const render = o.overrides?.render ?? (rs?.provider === "http" && rs.arg ? new HttpRenderBackend({ url: rs.arg, token: env.RENDER_TOKEN }) : undefined);

  return { llm, llmFast, tts, stt, music, sfx, stock, image, video, research, render };
}

/** Human/agent-readable summary of what is configured (no secrets). */
export function describeProviders(p: ProviderSet): Record<string, string | string[] | undefined> {
  return {
    llm: `${p.llm.id} (${p.llm.model})`,
    llmFast: p.llmFast ? `${p.llmFast.id} (${p.llmFast.model})` : undefined,
    tts: `${p.tts.id} [timestamps: ${p.tts.capabilities.timestamps}, ≤${p.tts.capabilities.maxCharsPerRequest} chars]`,
    stt: p.stt?.id,
    music: p.music?.id,
    sfx: p.sfx?.id,
    stock: p.stock?.map((s) => s.id),
    image: p.image?.id,
    video: p.video?.id,
    research: p.research?.map((r) => r.id),
    render: p.render?.id,
  };
}
