/**
 * Node-only providers that run fully offline through the HyperFrames CLI:
 *  - Kokoro-82M TTS (`hyperframes tts`, needs `pip install kokoro-onnx soundfile`)
 *  - whisper.cpp / Parakeet STT (`hyperframes transcribe`)
 * Together with a local LLM (Ollama) and stock/procedural media this gives a
 * zero-API, open-source pipeline.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioDuration, guardHallucinations, type STTProvider, type TTSCapabilities, type TTSProvider, type TTSRequest, type TTSResult, type WordTiming } from "@vid-skills/core";
import { exec } from "./exec.js";
import { hyperframesBin } from "./render.js";

export class LocalKokoroTTS implements TTSProvider {
  readonly id = "kokoro-local";
  readonly capabilities: TTSCapabilities = { maxCharsPerRequest: 900, timestamps: "none", ssml: false, instructions: false, contextStitching: false, languages: ["en-us", "en-gb", "es", "fr-fr", "hi", "it", "pt-br", "ja", "zh"], outputs: ["wav"], local: true };
  constructor(private readonly o: { voice?: string } = {}) {}
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const dir = await mkdtemp(join(tmpdir(), "vidsk-tts-"));
    try {
      const out = join(dir, "speech.wav");
      const txt = join(dir, "script.txt");
      await writeFile(txt, req.text);
      const { cmd, pre } = hyperframesBin();
      const r = await exec(cmd, [...pre, "tts", txt, "--voice", req.voice ?? this.o.voice ?? "am_michael", "--speed", String(req.speed ?? 1), "--output", out], { timeoutMs: 10 * 60_000, signal: req.signal });
      if (r.code !== 0) throw new Error(`hyperframes tts failed: ${(r.stderr || r.stdout).slice(-1500)}\nInstall: pip install kokoro-onnx soundfile`);
      const bytes = new Uint8Array(await readFile(out));
      return { bytes, mime: "audio/wav", durationSec: audioDuration(bytes, "audio/wav") ?? undefined, alignment: "none", license: { name: "Apache-2.0 (Kokoro-82M)", commercialUse: true, requiresAttribution: false } };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class LocalWhisperSTT implements STTProvider {
  readonly id = "whisper-local";
  readonly maxBytes = 2 * 2 ** 30;
  constructor(private readonly o: { model?: string } = {}) {}
  async transcribe(audio: { bytes: Uint8Array; mime: string }, opts: { language?: string } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "vidsk-stt-"));
    try {
      const f = join(dir, audio.mime.includes("mpeg") ? "a.mp3" : "a.wav");
      await writeFile(f, audio.bytes);
      const { cmd, pre } = hyperframesBin();
      const r = await exec(cmd, [...pre, "transcribe", f, "--dir", dir, "--model", this.o.model ?? "small.en", ...(opts.language ? ["--language", opts.language] : []), "--json"], { timeoutMs: 15 * 60_000 });
      if (r.code !== 0) throw new Error(`hyperframes transcribe failed: ${(r.stderr || r.stdout).slice(-1500)}`);
      const raw = JSON.parse(await readFile(join(dir, "transcript.json"), "utf8")) as { text: string; start: number; end: number }[] | { words?: { text: string; start: number; end: number }[] };
      const list = Array.isArray(raw) ? raw : (raw.words ?? []);
      const words: WordTiming[] = list.map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }));
      return { words: guardHallucinations(words), text: words.map((w) => w.text).join(" ") };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
