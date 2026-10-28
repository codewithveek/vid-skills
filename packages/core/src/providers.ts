/**
 * Provider contracts. The pipeline depends ONLY on these interfaces, so you can
 * plug in any model or vendor (hosted or local) by implementing a handful of
 * methods. Reference implementations live in `@vid-skills/providers`.
 */
import type { License, WordTiming } from "./spec.js";

/* ----------------------------- LLM -------------------------------- */

export type Role = "system" | "user" | "assistant";
export interface ChatMessage {
  role: Role;
  content: string;
}

export interface LLMCapabilities {
  /** Native JSON-schema constrained decoding (OpenAI json_schema, Gemini responseSchema, ...). */
  jsonSchema: boolean;
  /** Plain JSON mode (valid JSON, schema not enforced). */
  jsonMode: boolean;
  tools: boolean;
  vision: boolean;
  contextTokens: number;
  maxOutputTokens: number;
}

export interface LLMRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When set, the provider SHOULD use constrained decoding if it supports it. */
  json?: { name: string; schema: Record<string, unknown> };
  stop?: string[];
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  finishReason?: "stop" | "length" | "content_filter" | "tool_calls" | "other";
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  model?: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

/* ----------------------------- Audio ------------------------------ */

export interface AudioResult {
  bytes: Uint8Array;
  mime: string; // audio/wav, audio/mpeg, audio/pcm;rate=24000
  sampleRate?: number;
  durationSec?: number;
  license: License;
}

export interface TTSCapabilities {
  maxCharsPerRequest: number;
  timestamps: "word" | "char" | "none";
  ssml: boolean;
  /** accepts free-text delivery instructions (e.g. gpt-4o-mini-tts, ElevenLabs v3 audio tags) */
  instructions: boolean;
  /** supports previous/next text context so chunked requests keep prosody continuous */
  contextStitching: boolean;
  languages: string[] | "many";
  outputs: string[];
  local: boolean;
}

export interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  language?: string;
  instructions?: string;
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}

export interface TTSResult extends AudioResult {
  /** Word timings relative to the start of this audio, when the provider returns them. */
  words?: WordTiming[];
  alignment: "provider-word" | "provider-char" | "none";
}

export interface TTSProvider {
  readonly id: string;
  readonly capabilities: TTSCapabilities;
  synthesize(req: TTSRequest): Promise<TTSResult>;
  listVoices?(): Promise<{ id: string; name: string; language?: string; gender?: string }[]>;
}

export interface STTProvider {
  readonly id: string;
  readonly maxBytes: number;
  transcribe(audio: AudioResult | { bytes: Uint8Array; mime: string }, opts?: { language?: string; prompt?: string }): Promise<{
    words: WordTiming[];
    text: string;
    language?: string;
  }>;
}

export interface MusicRequest {
  prompt: string;
  durationSec: number;
  bpm?: number;
  instrumental?: boolean;
  signal?: AbortSignal;
}
export interface MusicProvider {
  readonly id: string;
  readonly maxDurationSec: number;
  readonly commercialUse: boolean;
  generate(req: MusicRequest): Promise<AudioResult>;
}

export interface SfxRequest {
  cue: string; // click, whoosh, pop, tick, riser, impact, swipe or free text
  prompt?: string;
  durationSec?: number;
  signal?: AbortSignal;
}
export interface SfxProvider {
  readonly id: string;
  generate(req: SfxRequest): Promise<AudioResult>;
}

/* ----------------------------- Visuals ---------------------------- */

export interface VisualCandidate {
  id: string;
  kind: "image" | "video";
  url: string; // direct downloadable URL
  previewUrl?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  description?: string;
  provider: string;
  license: License;
  /** Some providers require a "download ping" to count usage (Unsplash). */
  downloadTrackingUrl?: string;
}

export interface StockProvider {
  readonly id: string;
  readonly kinds: ("image" | "video")[];
  search(q: { query: string; kind: "image" | "video"; orientation?: "portrait" | "landscape" | "square"; limit?: number; signal?: AbortSignal }): Promise<VisualCandidate[]>;
}

export interface ImageGenRequest {
  prompt: string;
  width: number;
  height: number;
  negative?: string;
  seed?: number;
  signal?: AbortSignal;
}
export interface ImageProvider {
  readonly id: string;
  readonly commercialUse: boolean;
  generate(req: ImageGenRequest): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number; license: License }>;
}

export interface VideoGenRequest {
  prompt: string;
  imageUrl?: string;
  durationSec: number;
  aspect: "16:9" | "9:16" | "1:1";
  signal?: AbortSignal;
}
export interface VideoGenProvider {
  readonly id: string;
  readonly maxDurationSec: number;
  generate(req: VideoGenRequest): Promise<{ bytes: Uint8Array; mime: string; durationSec: number; license: License }>;
}

/* ----------------------------- Research --------------------------- */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  publishedAt?: string;
}
export interface ResearchProvider {
  readonly id: string;
  search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<SearchResult[]>;
  read?(url: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

/* ----------------------------- Storage / render ------------------- */

export interface StoredObject {
  key: string;
  size?: number;
  contentType?: string;
}

/** Blob storage abstraction (R2, S3, GCS, local fs, memory). Keys use "/" separators. */
export interface Storage {
  put(key: string, data: Uint8Array | string, contentType?: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  getText(key: string): Promise<string | null>;
  /** Optional ranged read (R2/S3/fs) so large videos can be uploaded in chunks without loading them whole. */
  getRange?(key: string, offset: number, length: number): Promise<Uint8Array | null>;
  /** Optional size lookup without reading the object. */
  size?(key: string): Promise<number | null>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<StoredObject[]>;
  delete?(key: string): Promise<void>;
  /** A URL a third party can fetch (signed or public). Needed for PULL_FROM_URL style publishing. */
  publicUrl?(key: string, ttlSec?: number): Promise<string | null>;
}

export interface RenderRequest {
  /** HyperFrames project files keyed by relative path. Strings are UTF-8; bytes are binary. */
  files: Record<string, string | Uint8Array>;
  /** Storage keys to materialize into the project (path -> key), avoids shipping bytes twice. */
  assetKeys?: Record<string, string>;
  fps: number;
  quality: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov";
  /** Post-render audio mastering targets */
  master?: { lufs: number; truePeak: number };
  signal?: AbortSignal;
}

export interface RenderResult {
  bytes?: Uint8Array;
  storageKey?: string;
  durationSec?: number;
  log?: string;
  measuredLufs?: number;
  measuredTruePeak?: number;
}

export interface RenderBackend {
  readonly id: string;
  render(req: RenderRequest, storage: Storage, outKey: string): Promise<RenderResult>;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  debug: (m, d) => console.debug(`[vidsk] ${m}`, d ?? ""),
  info: (m, d) => console.info(`[vidsk] ${m}`, d ?? ""),
  warn: (m, d) => console.warn(`[vidsk] ${m}`, d ?? ""),
  error: (m, d) => console.error(`[vidsk] ${m}`, d ?? ""),
};

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** Everything a pipeline run can use. Missing optional providers degrade gracefully. */
export interface ProviderSet {
  llm: LLMProvider;
  /** Optional cheaper/faster model for simple steps (copy, tagging). Falls back to llm. */
  llmFast?: LLMProvider;
  tts: TTSProvider;
  stt?: STTProvider;
  music?: MusicProvider;
  sfx?: SfxProvider;
  stock?: StockProvider[];
  image?: ImageProvider;
  video?: VideoGenProvider;
  research?: ResearchProvider[];
  render?: RenderBackend;
}
