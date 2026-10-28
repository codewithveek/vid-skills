/**
 * Text-to-speech adapters (open and paid). Every adapter reports its real limits
 * through `capabilities`, and the pipeline adapts: it chunks text under
 * `maxCharsPerRequest`, passes neighbouring text when `contextStitching` is
 * supported, and aligns words with STT or estimation when `timestamps` is "none".
 */
import { audioDuration, bytesFromBase64, charsToWords, estimateWordTimings, escapeHtml, pcm16ToWav, type License, type TTSCapabilities, type TTSProvider, type TTSRequest, type TTSResult, type WordTiming } from "@vid-skills/core";
import { ProviderError, request, requestBytes, requestJson } from "./http.js";
import { runWorkersAi, type AiBinding } from "./llm.js";

const commercial = (name: string, url?: string): License => ({ name, url, commercialUse: true, requiresAttribution: false });

function finish(bytes: Uint8Array, mime: string, words: WordTiming[] | undefined, alignment: TTSResult["alignment"], license: License): TTSResult {
  return { bytes, mime, durationSec: audioDuration(bytes, mime) ?? undefined, words, alignment, license };
}

/* ---------------------- ElevenLabs ------------------------ */

const ELEVEN_LIMITS: Record<string, number> = {
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_turbo_v2_5: 40000,
  eleven_flash_v2_5: 40000,
};

export class ElevenLabsTTS implements TTSProvider {
  readonly id = "elevenlabs";
  readonly capabilities: TTSCapabilities;
  constructor(private readonly o: { apiKey: string; voiceId: string; model?: string; baseUrl?: string; stability?: number; similarity?: number; style?: number; outputFormat?: string }) {
    const model = o.model ?? "eleven_multilingual_v2";
    this.capabilities = {
      maxCharsPerRequest: ELEVEN_LIMITS[model] ?? 5000,
      timestamps: "char",
      ssml: false,
      // v3 takes inline audio tags ([excited], [whispers]) instead of instructions; request stitching is not supported on v3.
      instructions: model === "eleven_v3",
      contextStitching: model !== "eleven_v3",
      languages: "many",
      outputs: ["mp3", "pcm"],
      local: false,
    };
  }
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const model = this.o.model ?? "eleven_multilingual_v2";
    const base = (this.o.baseUrl ?? "https://api.elevenlabs.io").replace(/\/$/, "");
    const fmt = this.o.outputFormat ?? "mp3_44100_128";
    const body: Record<string, unknown> = {
      text: req.text,
      model_id: model,
      voice_settings: { stability: this.o.stability ?? 0.45, similarity_boost: this.o.similarity ?? 0.8, style: this.o.style ?? 0.2, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, req.speed ?? 1)) },
    };
    if (this.capabilities.contextStitching) {
      if (req.previousText) body.previous_text = req.previousText.slice(-1000);
      if (req.nextText) body.next_text = req.nextText.slice(0, 1000);
    }
    const j = await requestJson<{ audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }; normalized_alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } }>(
      `${base}/v1/text-to-speech/${encodeURIComponent(req.voice ?? this.o.voiceId)}/with-timestamps?output_format=${fmt}`,
      { provider: this.id, method: "POST", headers: { "content-type": "application/json", "xi-api-key": this.o.apiKey }, body: JSON.stringify(body), signal: req.signal, retry: { timeoutMs: 240_000 } },
    );
    const al = j.alignment ?? j.normalized_alignment;
    const words = al ? charsToWords(al.characters, al.character_start_times_seconds, al.character_end_times_seconds) : undefined;
    let bytes = bytesFromBase64(j.audio_base64);
    let mime = fmt.startsWith("mp3") ? "audio/mpeg" : "audio/wav";
    if (fmt.startsWith("pcm_")) {
      bytes = pcm16ToWav(bytes, Number(fmt.split("_")[1] ?? 24000));
      mime = "audio/wav";
    }
    return finish(bytes, mime, words, words ? "provider-char" : "none", commercial("ElevenLabs (per plan terms)", "https://elevenlabs.io/terms-of-use"));
  }
}

/* ---------------------- OpenAI (and compatible /audio/speech) ------------------------ */

export class OpenAITTS implements TTSProvider {
  readonly id: string;
  readonly capabilities: TTSCapabilities;
  constructor(private readonly o: { apiKey?: string; baseUrl?: string; model?: string; voice?: string; id?: string; maxChars?: number; license?: License; local?: boolean; format?: "wav" | "mp3" }) {
    this.id = o.id ?? "openai";
    const model = o.model ?? "gpt-4o-mini-tts";
    this.capabilities = { maxCharsPerRequest: o.maxChars ?? 4096, timestamps: "none", ssml: false, instructions: /gpt-4o.*tts/.test(model), contextStitching: false, languages: "many", outputs: ["wav", "mp3"], local: o.local ?? false };
  }
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const fmt = this.o.format ?? "wav";
    const body: Record<string, unknown> = { model: this.o.model ?? "gpt-4o-mini-tts", input: req.text, voice: req.voice ?? this.o.voice ?? "onyx", response_format: fmt, speed: req.speed ?? 1 };
    if (this.capabilities.instructions && req.instructions) body.instructions = req.instructions;
    const { bytes } = await requestBytes(`${(this.o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`, {
      provider: this.id,
      method: "POST",
      headers: { "content-type": "application/json", ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: req.signal,
      retry: { timeoutMs: 240_000 },
    });
    return finish(bytes, fmt === "wav" ? "audio/wav" : "audio/mpeg", undefined, "none", this.o.license ?? commercial("OpenAI (disclose AI voice to listeners)", "https://openai.com/policies/usage-policies"));
  }
}

/* ---------------------- Kokoro (open, Apache-2.0) ------------------------ */

/**
 * Kokoro-82M through a Kokoro-FastAPI server (Docker: ghcr.io/remsky/kokoro-fastapi-cpu).
 * Uses /dev/captioned_speech for word timestamps and falls back to the OpenAI-compatible
 * /v1/audio/speech when that route is unavailable. Kokoro handles ~510 phoneme tokens per
 * pass; the server splits longer text, but shorter requests keep prosody tighter.
 */
export class KokoroTTS implements TTSProvider {
  readonly id = "kokoro";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 1000, timestamps: "word", ssml: false, instructions: false, contextStitching: false, languages: ["en-us", "en-gb", "es", "fr", "hi", "it", "ja", "pt-br", "zh"], outputs: ["wav", "mp3"], local: true };
  private captioned = true;
  constructor(private readonly o: { baseUrl: string; voice?: string; apiKey?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const base = this.o.baseUrl.replace(/\/$/, "");
    const voice = req.voice ?? this.o.voice ?? "am_michael";
    const headers = { "content-type": "application/json", ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}) };
    const lic: License = { name: "Apache-2.0 (Kokoro-82M)", url: "https://huggingface.co/hexgrad/Kokoro-82M", commercialUse: true, requiresAttribution: false };
    if (this.captioned) {
      try {
        const j = await requestJson<{ audio?: string; timestamps?: { word: string; start_time: number; end_time: number }[] }>(`${base}/dev/captioned_speech`, {
          provider: this.id,
          method: "POST",
          headers,
          body: JSON.stringify({ model: "kokoro", input: req.text, voice, speed: req.speed ?? 1, response_format: "wav", stream: false, return_timestamps: true }),
          signal: req.signal,
          retry: { retries: 1, timeoutMs: 180_000 },
        });
        if (j.audio) {
          const words = (j.timestamps ?? []).filter((t) => /\w/.test(t.word)).map((t) => ({ text: t.word, start: t.start_time, end: t.end_time }));
          return finish(bytesFromBase64(j.audio), "audio/wav", words.length ? words : undefined, words.length ? "provider-word" : "none", lic);
        }
      } catch (e) {
        if (e instanceof ProviderError && e.status !== undefined && e.status >= 500) throw e;
        this.captioned = false; // route missing on this server build → use the OpenAI route from now on
      }
    }
    const { bytes } = await requestBytes(`${base}/v1/audio/speech`, { provider: this.id, method: "POST", headers, body: JSON.stringify({ model: "kokoro", input: req.text, voice, speed: req.speed ?? 1, response_format: "wav" }), signal: req.signal, retry: { timeoutMs: 180_000 } });
    return finish(bytes, "audio/wav", undefined, "none", lic);
  }
  async listVoices() {
    const j = await requestJson<{ voices?: string[] }>(`${this.o.baseUrl.replace(/\/$/, "")}/v1/audio/voices`, { provider: this.id });
    return (j.voices ?? []).map((v) => ({ id: v, name: v, language: v[0] === "b" ? "en-gb" : "en-us", gender: v[1] === "m" ? "male" : "female" }));
  }
}

/* ---------------------- Cartesia ------------------------ */

export class CartesiaTTS implements TTSProvider {
  readonly id = "cartesia";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 4000, timestamps: "word", ssml: false, instructions: false, contextStitching: false, languages: "many", outputs: ["wav"], local: false };
  constructor(private readonly o: { apiKey: string; voiceId: string; model?: string; version?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const sr = 44100;
    const body = {
      model_id: this.o.model ?? "sonic-2",
      transcript: req.text,
      voice: { mode: "id", id: req.voice ?? this.o.voiceId },
      language: (req.language ?? "en").slice(0, 2),
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: sr },
      add_timestamps: true,
      ...(req.speed && req.speed !== 1 ? { speed: req.speed > 1 ? "fast" : "slow" } : {}),
    };
    const headers = { "content-type": "application/json", "X-API-Key": this.o.apiKey, "Cartesia-Version": this.o.version ?? "2025-04-16" };
    const res = await request("https://api.cartesia.ai/tts/sse", { provider: this.id, method: "POST", headers, body: JSON.stringify(body), signal: req.signal, retry: { timeoutMs: 240_000 } });
    const text = await res.text();
    const chunks: Uint8Array[] = [];
    const words: WordTiming[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as { type?: string; data?: string; word_timestamps?: { words: string[]; start: number[]; end: number[] } };
        if (ev.type === "chunk" && ev.data) chunks.push(bytesFromBase64(ev.data));
        if (ev.type === "timestamps" && ev.word_timestamps) ev.word_timestamps.words.forEach((w, i) => words.push({ text: w, start: ev.word_timestamps!.start[i]!, end: ev.word_timestamps!.end[i]! }));
      } catch {
        /* keep-alive / comments */
      }
    }
    if (!chunks.length) throw new ProviderError("cartesia: no audio in SSE stream", this.id, res.status, true);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      pcm.set(c, off);
      off += c.length;
    }
    return finish(pcm16ToWav(pcm, sr), "audio/wav", words.length ? words : undefined, words.length ? "provider-word" : "none", commercial("Cartesia (per plan terms)"));
  }
}

/* ---------------------- Google Cloud TTS (SSML marks → word timings) ------------------------ */

export class GoogleTTS implements TTSProvider {
  readonly id = "google";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 1500, timestamps: "word", ssml: true, instructions: false, contextStitching: false, languages: "many", outputs: ["wav"], local: false };
  constructor(private readonly o: { apiKey: string; voice?: string; languageCode?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    // 5,000-byte input limit counts SSML markup, hence the conservative 1,500 chars.
    const ws = req.text.split(/\s+/).filter(Boolean);
    const ssml = `<speak>${ws.map((w, i) => `<mark name="w${i}"/>${escapeHtml(w)}`).join(" ")}<mark name="end"/></speak>`;
    const j = await requestJson<{ audioContent: string; timepoints?: { markName: string; timeSeconds: number }[] }>(`https://texttospeech.googleapis.com/v1beta1/text:synthesize`, {
      provider: this.id,
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.o.apiKey },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: this.o.languageCode ?? "en-US", name: req.voice ?? this.o.voice ?? "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "LINEAR16", speakingRate: req.speed ?? 1, sampleRateHertz: 24000 },
        enableTimePointing: ["SSML_MARK"],
      }),
      signal: req.signal,
    });
    const tp = new Map((j.timepoints ?? []).map((t) => [t.markName, t.timeSeconds]));
    const bytes = bytesFromBase64(j.audioContent);
    const dur = audioDuration(bytes, "audio/wav") ?? 0;
    const words: WordTiming[] = ws.map((w, i) => {
      const s = tp.get(`w${i}`) ?? 0;
      const e = tp.get(`w${i + 1}`) ?? tp.get("end") ?? dur;
      return { text: w, start: s, end: Math.max(s + 0.05, e - 0.02) };
    });
    return finish(bytes, "audio/wav", tp.size ? words : undefined, tp.size ? "provider-word" : "none", commercial("Google Cloud TTS"));
  }
}

/* ---------------------- Azure AI Speech (REST) ------------------------ */

export class AzureTTS implements TTSProvider {
  readonly id = "azure";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 3000, timestamps: "none", ssml: true, instructions: false, contextStitching: false, languages: "many", outputs: ["wav"], local: false };
  constructor(private readonly o: { apiKey: string; region: string; voice?: string; style?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const voice = req.voice ?? this.o.voice ?? "en-US-AndrewMultilingualNeural";
    const rate = `${Math.round(((req.speed ?? 1) - 1) * 100)}%`;
    const inner = `<prosody rate="${rate}">${escapeHtml(req.text)}</prosody>`;
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voice}">${this.o.style ? `<mstts:express-as style="${this.o.style}">${inner}</mstts:express-as>` : inner}</voice></speak>`;
    const { bytes } = await requestBytes(`https://${this.o.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      provider: this.id,
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": this.o.apiKey, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm", "User-Agent": "vid-skills" },
      body: ssml,
      signal: req.signal,
    });
    return finish(bytes, "audio/wav", undefined, "none", commercial("Azure AI Speech"));
  }
}

/* ---------------------- Deepgram Aura ------------------------ */

export class DeepgramTTS implements TTSProvider {
  readonly id = "deepgram";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 2000, timestamps: "none", ssml: false, instructions: false, contextStitching: false, languages: ["en", "es"], outputs: ["wav"], local: false };
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const model = req.voice ?? this.o.model ?? "aura-2-orion-en";
    const { bytes } = await requestBytes(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}&encoding=linear16&container=wav&sample_rate=24000`, {
      provider: this.id,
      method: "POST",
      headers: { authorization: `Token ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ text: req.text }),
      signal: req.signal,
    });
    return finish(bytes, "audio/wav", undefined, "none", commercial("Deepgram"));
  }
}

/* ---------------------- Workers AI TTS ------------------------ */

export class WorkersAiTTS implements TTSProvider {
  readonly id = "workers-ai-tts";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 1500, timestamps: "none", ssml: false, instructions: false, contextStitching: false, languages: ["en"], outputs: ["mp3", "wav"], local: false };
  constructor(private readonly o: { model?: string; voice?: string; binding?: AiBinding; accountId?: string; apiToken?: string }) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const model = this.o.model ?? "@cf/deepgram/aura-2-en";
    const input: Record<string, unknown> = model.includes("melotts") ? { prompt: req.text, lang: (req.language ?? "en").slice(0, 2) } : { text: req.text, speaker: req.voice ?? this.o.voice ?? "orion", encoding: "mp3" };
    const out = await runWorkersAi(this.o, model, input, req.signal);
    let bytes: Uint8Array;
    if (out instanceof Uint8Array) bytes = out;
    else if (out && typeof out === "object" && "audio" in out && typeof (out as { audio: unknown }).audio === "string") bytes = bytesFromBase64((out as { audio: string }).audio);
    else if (out instanceof ReadableStream) bytes = new Uint8Array(await new Response(out).arrayBuffer());
    else throw new ProviderError("workers-ai-tts: unexpected response shape", this.id, undefined, false);
    const mime = bytes[0] === 0x52 && bytes[1] === 0x49 ? "audio/wav" : "audio/mpeg";
    return finish(bytes, mime, undefined, "none", commercial("Cloudflare Workers AI (model license applies)"));
  }
}

/* ---------------------- Fallback chain ------------------------ */

/**
 * Ordered TTS failover. Capabilities report the most restrictive limits so the
 * pipeline's chunks fit whichever provider ends up serving the request.
 * Keep voices consistent: the chain sticks to the first provider that succeeds
 * for the rest of the job (switching voices mid-video sounds broken).
 */
export class FallbackTTS implements TTSProvider {
  readonly id: string;
  private sticky: number | null = null;
  constructor(private readonly chain: TTSProvider[]) {
    if (!chain.length) throw new Error("FallbackTTS needs at least one provider");
    this.id = `fallback(${chain.map((c) => c.id).join(",")})`;
  }
  get capabilities(): TTSCapabilities {
    const c = this.sticky !== null ? [this.chain[this.sticky]!] : this.chain;
    const order = { word: 2, char: 1, none: 0 } as const;
    return {
      maxCharsPerRequest: Math.min(...c.map((x) => x.capabilities.maxCharsPerRequest)),
      timestamps: c.reduce<TTSCapabilities["timestamps"]>((a, x) => (order[x.capabilities.timestamps] < order[a] ? x.capabilities.timestamps : a), "word"),
      ssml: c.every((x) => x.capabilities.ssml),
      instructions: c.every((x) => x.capabilities.instructions),
      contextStitching: c.every((x) => x.capabilities.contextStitching),
      languages: "many",
      outputs: ["wav", "mp3"],
      local: c.every((x) => x.capabilities.local),
    };
  }
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    if (this.sticky !== null) return this.chain[this.sticky]!.synthesize(req);
    const errs: string[] = [];
    for (let i = 0; i < this.chain.length; i++) {
      try {
        const r = await this.chain[i]!.synthesize(req);
        this.sticky = i;
        return r;
      } catch (e) {
        if (req.signal?.aborted) throw e;
        errs.push(`${this.chain[i]!.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new ProviderError(`all TTS providers failed:\n${errs.join("\n")}`, this.id, undefined, true);
  }
}

/** Silent TTS for dry runs: correct durations and estimated word timings, no network. */
export class DryRunTTS implements TTSProvider {
  readonly id = "dry-run";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 5000, timestamps: "word", ssml: false, instructions: false, contextStitching: false, languages: "many", outputs: ["wav"], local: true };
  constructor(private readonly wpm = 170) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const n = req.text.split(/\s+/).filter(Boolean).length;
    const dur = (n / this.wpm) * 60 / (req.speed ?? 1) + 0.25;
    const sr = 16000;
    const bytes = pcm16ToWav(new Uint8Array(Math.floor(dur * sr) * 2), sr);
    return { bytes, mime: "audio/wav", durationSec: dur, words: estimateWordTimings(req.text, dur), alignment: "provider-word", license: { name: "generated", commercialUse: true, requiresAttribution: false } };
  }
}
