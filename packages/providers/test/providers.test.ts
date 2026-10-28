import { afterEach, describe, expect, it, vi } from "vitest";
import { base64FromBytes } from "@vid-skills/core";
import { ElevenLabsTTS, FallbackLLM, FallbackTTS, KokoroTTS, OpenAICompatibleLLM, PROVIDER_LIMITS, StaticLLM, describeProviders, limitsMarkdown, parseSpecs, providersFromEnv, request, ConfigError, WikimediaStock } from "../src/index.js";

const json = (v: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" }, ...init });

afterEach(() => vi.unstubAllGlobals());

describe("http", () => {
  it("retries 429 honouring Retry-After", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (++n < 3 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : json({ ok: true })));
    const res = await request("https://x.test", { provider: "t", retry: { baseMs: 1 } });
    expect(n).toBe(3);
    expect(res.ok).toBe(true);
  });
  it("does not retry 400 and redacts secrets", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n++;
      return new Response("bad api_key=sk-abcdefghijklmnopqrstuvwxyz", { status: 400 });
    });
    await expect(request("https://x.test", { provider: "t" })).rejects.toThrow(/\[redacted\]/);
    expect(n).toBe(1);
  });
});

describe("wikimedia", () => {
  it("backs off on in-body ratelimited errors instead of returning no results", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", async () =>
      ++n === 1
        ? json({ error: { code: "ratelimited", info: "You've exceeded your rate limit." } })
        : json({ query: { pages: { "1": { title: "File:UPCA.jpg", imageinfo: [{ url: "https://u.test/a.jpg", width: 800, height: 600, descriptionurl: "https://c.test/File:UPCA.jpg", extmetadata: { LicenseShortName: { value: "Public domain" } } }] } } } }),
    );
    const p = new WikimediaStock().search({ query: "UPCA", kind: "image" });
    await vi.advanceTimersByTimeAsync(6_000);
    const res = await p;
    vi.useRealTimers();
    expect(n).toBe(2);
    expect(res.map((c) => c.description)).toEqual(["File:UPCA.jpg"]);
    expect(res[0]!.license.commercialUse).toBe(true);
  });
});

describe("llm adapters", () => {
  it("adapts max_tokens dialect and drops temperature when rejected", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(b);
      if ("max_tokens" in b) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'" } }), { status: 400 });
      if ("temperature" in b) return new Response(JSON.stringify({ error: { message: "temperature does not support 0.7" } }), { status: 400 });
      return json({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] });
    });
    const llm = new OpenAICompatibleLLM({ baseUrl: "https://api.test/v1", model: "m", apiKey: "k" });
    const r = await llm.complete({ messages: [{ role: "user", content: "x" }], temperature: 0.7 });
    expect(r.text).toBe("hi");
    expect(bodies.length).toBe(3);
    expect(bodies[2]).toHaveProperty("max_completion_tokens");
    expect(bodies[2]).not.toHaveProperty("temperature");
  });
  it("falls back across providers", async () => {
    const bad = new StaticLLM({});
    const good = new StaticLLM({ X: { a: 1 } });
    const f = new FallbackLLM([bad, good]);
    const r = await f.complete({ messages: [{ role: "user", content: "x" }], json: { name: "X", schema: {} } });
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });
});

describe("tts adapters", () => {
  it("elevenlabs converts char alignment to words", async () => {
    const chars = [..."Hi you"];
    vi.stubGlobal("fetch", async () =>
      json({ audio_base64: base64FromBytes(new Uint8Array([0xff, 0xfb, 0x90, 0, 0])), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1) } }),
    );
    const t = new ElevenLabsTTS({ apiKey: "k", voiceId: "v", model: "eleven_flash_v2_5" });
    expect(t.capabilities.maxCharsPerRequest).toBe(40000);
    const r = await t.synthesize({ text: "Hi you" });
    expect(r.words?.map((w) => w.text)).toEqual(["Hi", "you"]);
    expect(r.alignment).toBe("provider-char");
  });
  it("kokoro falls back to the OpenAI route when captioned_speech is missing", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      urls.push(u);
      if (u.endsWith("/dev/captioned_speech")) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(100), { headers: { "content-type": "audio/wav" } });
    });
    const k = new KokoroTTS({ baseUrl: "http://k.test" });
    const r = await k.synthesize({ text: "hello" });
    expect(r.alignment).toBe("none");
    await k.synthesize({ text: "again" });
    expect(urls.filter((u) => u.endsWith("captioned_speech")).length).toBe(1);
  });
  it("fallback tts sticks to the first provider that works", async () => {
    let calls = 0;
    const failing = { id: "a", capabilities: { maxCharsPerRequest: 100, timestamps: "word" as const, ssml: false, instructions: false, contextStitching: false, languages: "many" as const, outputs: [], local: false }, synthesize: async () => { calls++; throw new Error("down"); } };
    const ok = { ...failing, id: "b", synthesize: async () => ({ bytes: new Uint8Array(), mime: "audio/wav", alignment: "none" as const, license: { name: "x", commercialUse: true, requiresAttribution: false } }) };
    const f = new FallbackTTS([failing, ok]);
    await f.synthesize({ text: "1" });
    await f.synthesize({ text: "2" });
    expect(calls).toBe(1);
  });
});

describe("registry", () => {
  it("parses specs", () => {
    expect(parseSpecs("elevenlabs:VOICE@eleven_v3, kokoro")).toEqual([
      { provider: "elevenlabs", arg: "VOICE", model: "eleven_v3" },
      { provider: "kokoro", arg: undefined, model: undefined },
    ]);
    expect(parseSpecs("compat:https://h.test/v1#qwen")[0]).toEqual({ provider: "compat", arg: "https://h.test/v1", model: "qwen" });
  });
  it("auto-detects from keys", () => {
    const p = providersFromEnv({ ANTHROPIC_API_KEY: "a", KOKORO_BASE_URL: "http://k", PEXELS_API_KEY: "p" });
    const d = describeProviders(p);
    expect(d.llm).toContain("anthropic");
    expect(d.tts).toContain("kokoro");
    expect(d.stock).toEqual(["pexels", "openverse", "wikimedia"]);
    expect(d.research).toEqual(["wikipedia"]);
  });
  it("explains missing config", () => {
    expect(() => providersFromEnv({})).toThrow(ConfigError);
  });
  it("limits registry renders", () => {
    expect(PROVIDER_LIMITS.length).toBeGreaterThan(10);
    expect(limitsMarkdown()).toContain("Workarounds implemented");
  });
});
