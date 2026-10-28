/** Speech-to-text, music and sound-effect adapters. */
import {
  audioDuration,
  base64FromBytes,
  guardHallucinations,
  synthSfx,
  type AudioResult,
  type License,
  type MusicProvider,
  type MusicRequest,
  type SfxProvider,
  type SfxRequest,
  type STTProvider,
  type WordTiming,
} from "@vid-skills/core";
import { runHosted, type HostedModel } from "./hosted.js";
import { ProviderError, requestBytes, requestJson } from "./http.js";
import { runWorkersAi, type AiBinding } from "./llm.js";

const ext = (mime: string) => (mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "wav");

/* ============================ STT ============================ */

/**
 * OpenAI-compatible transcription with word timestamps: OpenAI whisper-1, Groq
 * whisper-large-v3(-turbo), self-hosted faster-whisper servers (Speaches) etc.
 * 25 MB request limit: voice chunks are small, but larger inputs are rejected
 * early so the caller can fall back to estimation instead of a 413.
 */
export class WhisperSTT implements STTProvider {
  readonly id: string;
  readonly maxBytes: number;
  constructor(private readonly o: { apiKey?: string; baseUrl?: string; model?: string; id?: string; maxBytes?: number }) {
    this.id = o.id ?? "whisper";
    this.maxBytes = o.maxBytes ?? 25 * 2 ** 20;
  }
  async transcribe(audio: { bytes: Uint8Array; mime: string }, opts: { language?: string; prompt?: string } = {}) {
    if (audio.bytes.length > this.maxBytes) throw new ProviderError(`${this.id}: audio exceeds ${this.maxBytes} bytes`, this.id, 413, false);
    const fd = new FormData();
    fd.set("file", new Blob([audio.bytes as BlobPart], { type: audio.mime }), `audio.${ext(audio.mime)}`);
    fd.set("model", this.o.model ?? "whisper-1");
    fd.set("response_format", "verbose_json");
    fd.append("timestamp_granularities[]", "word");
    fd.append("timestamp_granularities[]", "segment");
    if (opts.language) fd.set("language", opts.language.slice(0, 2));
    if (opts.prompt) fd.set("prompt", opts.prompt.slice(0, 800)); // biases spelling of names/terms
    const j = await requestJson<{ text?: string; language?: string; words?: { word: string; start: number; end: number; probability?: number }[] }>(`${(this.o.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/audio/transcriptions`, {
      provider: this.id,
      method: "POST",
      headers: this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {},
      body: fd,
      retry: { timeoutMs: 300_000 },
    });
    const words: WordTiming[] = (j.words ?? []).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end, confidence: w.probability }));
    return { words: guardHallucinations(words), text: j.text ?? "", language: j.language };
  }
}

export class DeepgramSTT implements STTProvider {
  readonly id = "deepgram-stt";
  readonly maxBytes = 2 * 2 ** 30;
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async transcribe(audio: { bytes: Uint8Array; mime: string }, opts: { language?: string } = {}) {
    const j = await requestJson<{ results?: { channels?: { alternatives?: { transcript?: string; words?: { word: string; punctuated_word?: string; start: number; end: number; confidence?: number }[] }[] }[] } }>(
      `https://api.deepgram.com/v1/listen?model=${this.o.model ?? "nova-3"}&smart_format=true&punctuate=true${opts.language ? `&language=${opts.language}` : ""}`,
      { provider: this.id, method: "POST", headers: { authorization: `Token ${this.o.apiKey}`, "content-type": audio.mime }, body: audio.bytes as BodyInit, retry: { timeoutMs: 300_000 } },
    );
    const alt = j.results?.channels?.[0]?.alternatives?.[0];
    return { words: (alt?.words ?? []).map((w) => ({ text: w.punctuated_word ?? w.word, start: w.start, end: w.end, confidence: w.confidence })), text: alt?.transcript ?? "" };
  }
}

export class ElevenLabsSTT implements STTProvider {
  readonly id = "elevenlabs-scribe";
  readonly maxBytes = 1 * 2 ** 30;
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async transcribe(audio: { bytes: Uint8Array; mime: string }, opts: { language?: string } = {}) {
    const fd = new FormData();
    fd.set("file", new Blob([audio.bytes as BlobPart], { type: audio.mime }), `audio.${ext(audio.mime)}`);
    fd.set("model_id", this.o.model ?? "scribe_v1");
    if (opts.language) fd.set("language_code", opts.language);
    const j = await requestJson<{ text?: string; language_code?: string; words?: { text: string; start: number; end: number; type?: string }[] }>("https://api.elevenlabs.io/v1/speech-to-text", { provider: this.id, method: "POST", headers: { "xi-api-key": this.o.apiKey }, body: fd, retry: { timeoutMs: 300_000 } });
    return { words: (j.words ?? []).filter((w) => w.type !== "spacing" && w.type !== "audio_event").map((w) => ({ text: w.text, start: w.start, end: w.end })), text: j.text ?? "", language: j.language_code };
  }
}

export class WorkersAiSTT implements STTProvider {
  readonly id = "workers-ai-stt";
  readonly maxBytes = 20 * 2 ** 20;
  constructor(private readonly o: { model?: string; binding?: AiBinding; accountId?: string; apiToken?: string }) {}
  async transcribe(audio: { bytes: Uint8Array; mime: string }) {
    const model = this.o.model ?? "@cf/openai/whisper";
    const input = model.includes("turbo") ? { audio: base64FromBytes(audio.bytes) } : { audio: [...audio.bytes] };
    const out = (await runWorkersAi(this.o, model, input)) as { text?: string; words?: { word: string; start: number; end: number }[]; segments?: { words?: { word: string; start: number; end: number }[] }[] };
    const raw = out.words ?? out.segments?.flatMap((s) => s.words ?? []) ?? [];
    return { words: guardHallucinations(raw.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }))), text: out.text ?? "" };
  }
}

/* ============================ Music ============================ */

export class ElevenLabsMusic implements MusicProvider {
  readonly id = "elevenlabs-music";
  readonly maxDurationSec = 300;
  readonly commercialUse = true;
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async generate(req: MusicRequest): Promise<AudioResult> {
    const ms = Math.round(Math.min(this.maxDurationSec, Math.max(10, req.durationSec)) * 1000);
    const { bytes, mime } = await requestBytes(`https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128`, {
      provider: this.id,
      method: "POST",
      headers: { "xi-api-key": this.o.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ prompt: req.prompt, music_length_ms: ms, model_id: this.o.model ?? "music_v1", force_instrumental: req.instrumental !== false }),
      signal: req.signal,
      retry: { timeoutMs: 600_000 },
    });
    return { bytes, mime: mime.startsWith("audio/") ? mime : "audio/mpeg", durationSec: audioDuration(bytes, "audio/mpeg") ?? ms / 1000, license: { name: "ElevenLabs Music (cleared for commercial use per plan)", url: "https://elevenlabs.io/music-terms", commercialUse: true, requiresAttribution: false } };
  }
}

export class StableAudioMusic implements MusicProvider {
  readonly id = "stable-audio";
  readonly maxDurationSec = 180;
  readonly commercialUse = true;
  constructor(private readonly o: { apiKey: string; model?: string }) {}
  async generate(req: MusicRequest): Promise<AudioResult> {
    const fd = new FormData();
    fd.set("prompt", req.prompt + (req.bpm ? `, ${req.bpm} BPM` : ""));
    fd.set("duration", String(Math.min(this.maxDurationSec, Math.max(1, Math.round(req.durationSec)))));
    fd.set("output_format", "mp3");
    if (this.o.model) fd.set("model", this.o.model);
    const { bytes } = await requestBytes("https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio", { provider: this.id, method: "POST", headers: { authorization: `Bearer ${this.o.apiKey}`, accept: "audio/*" }, body: fd, signal: req.signal, retry: { timeoutMs: 600_000 } });
    return { bytes, mime: "audio/mpeg", durationSec: audioDuration(bytes, "audio/mpeg") ?? req.durationSec, license: { name: "Stability AI (license per plan)", url: "https://stability.ai/license", commercialUse: true, requiresAttribution: false } };
  }
}

/** Any music model on fal/Replicate (MusicGen, ACE-Step, Stable Audio Open, Lyria…). */
export class HostedMusic implements MusicProvider {
  readonly id: string;
  constructor(
    private readonly m: HostedModel,
    readonly maxDurationSec = 30,
    readonly commercialUse = false,
    private readonly license?: License,
  ) {
    this.id = `${m.host}:${m.model}`;
  }
  async generate(req: MusicRequest): Promise<AudioResult> {
    const d = Math.min(this.maxDurationSec, Math.round(req.durationSec));
    const { bytes, mime } = await runHosted(this.m, { prompt: req.prompt, duration: d }, req.signal);
    const m = mime.startsWith("audio/") ? mime : "audio/wav";
    return { bytes, mime: m, durationSec: audioDuration(bytes, m) ?? d, license: this.license ?? { name: `model license: ${this.m.model} (verify before commercial use)`, commercialUse: this.commercialUse, requiresAttribution: false } };
  }
}

/** Music from your own licensed library (files or URLs tagged with moods). */
export class LibraryMusic implements MusicProvider {
  readonly id = "library";
  readonly maxDurationSec = 3600;
  readonly commercialUse = true;
  constructor(private readonly tracks: { url: string; tags: string[]; durationSec?: number; license: License }[]) {}
  async generate(req: MusicRequest): Promise<AudioResult> {
    const words = req.prompt.toLowerCase().split(/\W+/);
    const scored = this.tracks.map((t) => ({ t, s: t.tags.filter((g) => words.includes(g.toLowerCase())).length })).sort((a, b) => b.s - a.s);
    const pick = scored[0]?.t;
    if (!pick) throw new ProviderError("library: no tracks", this.id, undefined, false);
    const { bytes, mime } = await requestBytes(pick.url, { provider: this.id, signal: req.signal });
    return { bytes, mime, durationSec: pick.durationSec ?? audioDuration(bytes, mime) ?? undefined, license: pick.license };
  }
}

/* ============================ SFX ============================ */

const CUE_PROMPTS: Record<string, string> = {
  click: "single crisp mouse click, close mic, dry",
  tick: "soft mechanical keyboard key tick, very short, dry",
  pop: "small soft UI pop, bubbly, short",
  whoosh: "fast airy whoosh transition, short, no music",
  swipe: "quick paper swipe, page turn, short",
  riser: "tension riser building over 1.5 seconds, cinematic, no music",
  impact: "deep cinematic impact hit with short tail",
};

export class ElevenLabsSfx implements SfxProvider {
  readonly id = "elevenlabs-sfx";
  constructor(private readonly o: { apiKey: string }) {}
  async generate(req: SfxRequest): Promise<AudioResult> {
    const { bytes } = await requestBytes("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      provider: this.id,
      method: "POST",
      headers: { "xi-api-key": this.o.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text: req.prompt ?? CUE_PROMPTS[req.cue] ?? req.cue, duration_seconds: Math.min(30, Math.max(0.5, req.durationSec ?? 1)), prompt_influence: 0.6 }),
      signal: req.signal,
    });
    return { bytes, mime: "audio/mpeg", durationSec: audioDuration(bytes, "audio/mpeg") ?? undefined, license: { name: "ElevenLabs SFX (royalty-free per plan)", commercialUse: true, requiresAttribution: false } };
  }
}

/** Freesound (CC0 only by default so no attribution bookkeeping is needed). */
export class FreesoundSfx implements SfxProvider {
  readonly id = "freesound";
  constructor(private readonly o: { apiKey: string; licenses?: string[] }) {}
  async generate(req: SfxRequest): Promise<AudioResult> {
    const lic = this.o.licenses ?? ["Creative Commons 0"];
    const q = encodeURIComponent(req.prompt ?? req.cue);
    const filter = encodeURIComponent(`duration:[0.05 TO ${Math.max(1, (req.durationSec ?? 1) * 3)}] (${lic.map((l) => `license:"${l}"`).join(" OR ")})`);
    const j = await requestJson<{ results?: { id: number; name: string; username: string; license: string; previews?: Record<string, string> }[] }>(
      `https://freesound.org/apiv2/search/text/?query=${q}&filter=${filter}&fields=id,name,username,license,previews&page_size=10&sort=rating_desc&token=${this.o.apiKey}`,
      { provider: this.id, rateKey: "freesound", ratePerMinute: 55 },
    );
    const hit = j.results?.[0];
    const url = hit?.previews?.["preview-hq-mp3"];
    if (!hit || !url) throw new ProviderError(`freesound: nothing for "${req.cue}"`, this.id, 404, false);
    const { bytes } = await requestBytes(url, { provider: this.id, signal: req.signal });
    const cc0 = /Creative Commons 0|publicdomain\/zero/i.test(hit.license);
    return { bytes, mime: "audio/mpeg", license: { name: cc0 ? "CC0-1.0" : hit.license, url: `https://freesound.org/s/${hit.id}/`, attribution: `"${hit.name}" by ${hit.username} (freesound.org)`, commercialUse: !/noncommercial|by-nc/i.test(hit.license), requiresAttribution: !cc0 } };
  }
}

/** Openverse audio (no key needed, CC-licensed, commercial filter on). */
export class OpenverseSfx implements SfxProvider {
  readonly id = "openverse-audio";
  async generate(req: SfxRequest): Promise<AudioResult> {
    const j = await requestJson<{ results?: { url: string; title?: string; creator?: string; license: string; license_version?: string; foreign_landing_url?: string; duration?: number }[] }>(
      `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(req.prompt ?? req.cue)}&license_type=commercial&page_size=10`,
      { provider: this.id, rateKey: "openverse", ratePerMinute: 20 },
    );
    const hit = (j.results ?? []).find((r) => !r.duration || r.duration < 8000);
    if (!hit) throw new ProviderError(`openverse: nothing for ${req.cue}`, this.id, 404, false);
    const { bytes, mime } = await requestBytes(hit.url, { provider: this.id, signal: req.signal });
    return { bytes, mime, license: { name: `CC ${hit.license.toUpperCase()} ${hit.license_version ?? ""}`.trim(), url: hit.foreign_landing_url, attribution: `${hit.title ?? "sound"} by ${hit.creator ?? "unknown"}`, commercialUse: true, requiresAttribution: hit.license !== "cc0" && hit.license !== "pdm" } };
  }
}

/** Procedural fallback, always available (see core/audio/synth). */
export class ProceduralSfx implements SfxProvider {
  readonly id = "procedural";
  private n = 0;
  async generate(req: SfxRequest): Promise<AudioResult> {
    const s = synthSfx(req.cue, this.n++);
    return { bytes: s.bytes, mime: s.mime, durationSec: s.durationSec, license: { name: "generated", commercialUse: true, requiresAttribution: false } };
  }
}

export class FallbackSfx implements SfxProvider {
  readonly id: string;
  constructor(private readonly chain: SfxProvider[]) {
    this.id = `fallback(${chain.map((c) => c.id).join(",")})`;
  }
  async generate(req: SfxRequest): Promise<AudioResult> {
    for (const p of this.chain) {
      try {
        return await p.generate(req);
      } catch {
        /* next */
      }
    }
    return new ProceduralSfx().generate(req);
  }
}
