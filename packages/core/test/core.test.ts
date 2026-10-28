import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  audioDuration,
  buildCaptionCues,
  charsToWords,
  compileHyperFrames,
  estimateWordTimings,
  extractJson,
  floatToWav,
  framedExplainer,
  generateStructured,
  guardHallucinations,
  jsonSchemas,
  mapLinesToWords,
  MemoryStorage,
  mp3Duration,
  runPipeline,
  sliceAutomation,
  synthSfx,
  toSrt,
  VideoBrief,
} from "../src/index.js";
import { fakeLLM, fakeTTS } from "./fixtures.js";

describe("json extraction", () => {
  it("handles fences, prose and trailing commas", () => {
    expect(extractJson('Sure!\n```json\n{"a":[1,2,],}\n```')).toEqual({ a: [1, 2] });
    expect(extractJson('blah {"x":{"y":"}"}} trailing')).toEqual({ x: { y: "}" } });
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });
});

describe("structured generation", () => {
  it("repairs invalid output", async () => {
    const llm = fakeLLM({ garbleFirst: true });
    const S = z.object({ topic: z.string(), claims: z.array(z.any()).min(1) });
    const out = await generateStructured({ llm, schema: S, name: "ResearchDossier", system: "s", user: "Build a research dossier" });
    expect(out.topic).toContain("floppy");
    expect(llm.calls).toBe(2);
  });
});

describe("transcript utilities", () => {
  it("converts char alignment to words", () => {
    const chars = [..."hi there"];
    const ws = charsToWords(chars, chars.map((_, i) => i * 0.1), chars.map((_, i) => i * 0.1 + 0.1));
    expect(ws.map((w) => w.text)).toEqual(["hi", "there"]);
    expect(ws[1]!.start).toBeCloseTo(0.3);
  });
  it("estimates monotonic timings within duration", () => {
    const ws = estimateWordTimings("Back in 1973, selling electronics was a headache.", 3.2);
    expect(ws.length).toBe(8);
    for (let i = 1; i < ws.length; i++) expect(ws[i]!.start).toBeGreaterThanOrEqual(ws[i - 1]!.end - 1e-9);
    expect(ws[ws.length - 1]!.end).toBeLessThanOrEqual(3.2);
  });
  it("drops hallucinated outros over silence", () => {
    const ws = [
      { text: "go", start: 0, end: 0.3, confidence: 0.9 },
      { text: "Thanks", start: 5, end: 5.3, confidence: 0.3 },
      { text: "for", start: 5.3, end: 5.4, confidence: 0.3 },
      { text: "watching!", start: 5.4, end: 5.9, confidence: 0.3 },
    ];
    expect(guardHallucinations(ws).map((w) => w.text)).toEqual(["go"]);
  });
  it("maps lines onto words in order", () => {
    const lines = [
      { id: "a", text: "one two three" },
      { id: "b", text: "four five" },
    ];
    const spoken = estimateWordTimings("one two three four five", 3);
    const m = mapLinesToWords(lines, spoken);
    expect(m[0]!.lastWord).toBe(2);
    expect(m[1]!.firstWord).toBe(3);
  });
});

describe("audio", () => {
  it("measures wav and synthesizes sfx", () => {
    const wav = floatToWav(new Float32Array(48000), 48000);
    expect(audioDuration(wav, "audio/wav")).toBeCloseTo(1, 3);
    const s = synthSfx("whoosh");
    expect(audioDuration(s.bytes, s.mime)).toBeCloseTo(s.durationSec, 2);
  });
  it("parses an mp3 frame stream", () => {
    // Two MPEG-1 Layer III frames, 128 kbps, 44.1 kHz → 417 bytes each
    const frame = new Uint8Array(417);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x90;
    const buf = new Uint8Array(834);
    buf.set(frame, 0);
    buf.set(frame, 417);
    expect(mp3Duration(buf)).toBeCloseTo((2 * 1152) / 44100, 4);
  });
  it("slices automation per clip", () => {
    const pts = [
      { t: 0, v: 0.1 },
      { t: 10, v: 1.1 },
    ];
    const s = sliceAutomation(pts, 5, 8);
    expect(s[0]).toEqual({ t: 0, v: 0.6 });
    expect(s[s.length - 1]!.t).toBe(3);
  });
});

describe("captions", () => {
  it("groups short cues and exports srt", () => {
    const ws = estimateWordTimings("Phones, laptops, consoles, the TV remote on your couch.", 3);
    const cues = buildCaptionCues(ws, framedExplainer, ["remote"]);
    expect(cues.every((c) => c.words.length <= framedExplainer.captions.maxWordsPerCue)).toBe(true);
    expect(toSrt(cues)).toMatch(/00:00:00,0\d\d --> /);
  });
});

describe("schemas", () => {
  it("exports JSON schemas for every contract", () => {
    const s = jsonSchemas();
    expect(Object.keys(s)).toContain("VideoBrief");
    expect(JSON.stringify(s.Scene)).toContain("typewriter");
  });
});

describe("pipeline (offline, mock providers)", () => {
  it("produces a valid HyperFrames project", async () => {
    const storage = new MemoryStorage();
    const res = await runPipeline(
      { topic: "the floppy disk save icon", durationSec: 25, handle: "@vidskills", platforms: ["youtube_shorts", "tiktok"] },
      { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage, jobId: "t1" },
    );
    const tl = res.timeline!;
    expect(tl.scenes[0]!.start).toBe(0);
    for (let i = 1; i < tl.scenes.length; i++) expect(tl.scenes[i]!.start).toBeGreaterThan(tl.scenes[i - 1]!.start);
    // typewriter shot lands on the year
    const tw = tl.scenes.find((s) => s.scene.type === "typewriter")!;
    const l4 = tl.scenes.find((s) => s.lineId === "l4")!;
    expect(tw.start).toBeGreaterThanOrEqual(l4.start);
    expect(tl.audio.some((a) => a.role === "voice")).toBe(true);
    expect(tl.audio.some((a) => a.role === "sfx")).toBe(true);
    const p = res.project!;
    expect(p.files["index.html"]).toContain('data-composition-id="main"');
    for (const s of tl.scenes) expect(p.files[`compositions/s-${s.id}.html`]).toContain(`window.__timelines["s-${s.id}"]`);
    expect(p.files["compositions/chrome.html"]).toContain("Your Save Icon Is a Fossil");
    // the brief's handle overrides the storyboard's placeholder on the end card and watermark
    const end = tl.scenes.find((s) => s.scene.type === "endcard")!;
    expect(end.scene.type === "endcard" && end.scene.handle).toBe("@vidskills");
    expect(Object.keys(p.assetPaths).length).toBeGreaterThan(5);
    expect(res.qa!.findings.find((f) => f.code === "frame0_empty")).toBeUndefined();
    expect(res.copy!.title.length).toBeGreaterThan(5);
    // resumable: a second run skips every stage
    const stages: string[] = [];
    await runPipeline({ topic: "the floppy disk save icon", durationSec: 25 }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage, jobId: "t1", onProgress: (s, st) => stages.push(`${s}:${st}`) });
    expect(stages.filter((s) => s.endsWith(":running"))).toEqual([]);
  });
  it("brief defaults are sane", () => {
    const b = VideoBrief.parse({ topic: "x y z" });
    expect(b.aspect).toBe("9:16");
    expect(b.voice.targetWpm).toBe(170);
  });
});

describe("compile", () => {
  it("escapes text and emits audio automation", async () => {
    const storage = new MemoryStorage();
    const res = await runPipeline({ topic: "t <script>", durationSec: 20, headline: 'A "quoted" <b>headline</b>' }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage, jobId: "t2" });
    const chrome = res.project!.files["compositions/chrome.html"]!;
    expect(chrome).not.toContain("<b>headline</b>");
    expect(chrome).toContain("&lt;b&gt;");
    const p2 = compileHyperFrames(res.timeline!, { assets: res.manifest.assets, style: framedExplainer, aspect: "9:16" });
    expect(p2.files["index.html"]).toContain("data-audio-group");
    // caption words get an explicit gap (text strokes eat plain spaces)
    expect(p2.files["compositions/captions.html"]).toMatch(/column-gap: 0\.32em/);
  });
});
