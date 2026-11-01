import { describe, expect, it, vi } from "vitest";
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
  ICONS,
  iconSvg,
  placeholderLabel,
  posterFor,
  rankCandidates,
  resolveIcon,
  type StockProvider,
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
  it("skips the Xing/Info frame and trims LAME encoder delay and padding", () => {
    const frame = () => Uint8Array.from({ length: 417 }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xfb : i === 2 ? 0x90 : 0));
    const info = frame();
    info.set([..."Info"].map((c) => c.charCodeAt(0)), 36);
    info.set([..."LAME"].map((c) => c.charCodeAt(0)), 156);
    // 12-bit delay (1105) and 12-bit padding (807) at LAME+21
    info.set([1105 >> 4, ((1105 & 0x0f) << 4) | (807 >> 8), 807 & 0xff], 156 + 21);
    const buf = new Uint8Array(417 * 11);
    buf.set(info, 0);
    for (let i = 1; i < 11; i++) buf.set(frame(), 417 * i);
    expect(mp3Duration(buf)).toBeCloseTo((10 * 1152 - 1105 - 807) / 44100, 5);
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
    // the red headline has a white outline only: no backdrop band, no drop shadow
    const titleCss = /#chrome-title \{[^}]*\}/.exec(p.files["compositions/chrome.html"]!)![0];
    expect(titleCss).not.toContain("text-shadow");
    expect(p.files["compositions/chrome.html"]).not.toMatch(/\.vs-title-band \{[^}]*background/);
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
  it("re-running assets reuses what already resolved", async () => {
    const storage = new MemoryStorage();
    let searches = 0;
    let n = 0;
    const stock: StockProvider = {
      id: "fake-stock",
      kinds: ["image"],
      search: async () => {
        searches++;
        const url = `data:image/png;base64,${btoa(`img${n++}`)}`;
        return [{ id: url, kind: "image", url, width: 1600, height: 1100, provider: "fake-stock", license: { name: "CC0", commercialUse: true, requiresAttribution: false } }];
      },
    };
    const run = (force?: ("assets" | "timeline")[]) =>
      runPipeline({ topic: "the floppy disk save icon", durationSec: 25 }, { providers: { llm: fakeLLM(), tts: fakeTTS(), stock: [stock] }, storage, jobId: "t3", stopAfter: "assets", force });
    const first = await run();
    const fetched = searches;
    expect(fetched).toBeGreaterThan(0);
    const second = await run(["assets"]);
    expect(searches).toBe(fetched);
    expect(second.manifest.assets.filter((a) => a.provider === "fake-stock").length).toBe(first.manifest.assets.filter((a) => a.provider === "fake-stock").length);
  });
  it("retries a throttled asset download", async () => {
    let calls = 0;
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith("https://media.test/")) return realFetch(input, init);
      calls++;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }) : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    });
    try {
      const stock: StockProvider = {
        id: "fake-stock",
        kinds: ["image"],
        search: async ({ query }) => [{ id: query, kind: "image", url: `https://media.test/${encodeURIComponent(query)}.jpg`, width: 1600, height: 1100, provider: "fake-stock", license: { name: "CC0", commercialUse: true, requiresAttribution: false } }],
      };
      const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25 }, { providers: { llm: fakeLLM(), tts: fakeTTS(), stock: [stock] }, storage: new MemoryStorage(), jobId: "t4", stopAfter: "assets" });
      expect(calls).toBeGreaterThan(1);
      expect(res.manifest.assets.some((a) => a.provider === "fake-stock")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("labels placeholder cards with readable words, not search syntax", () => {
    expect(placeholderLabel('intitle:"Guy Fawkes night at Chirk"')).toBe("Guy Fawkes night at Chirk");
    expect(placeholderLabel('filetype:bitmap intitle:"Wea00610 (9672651296).jpg"')).toBe("Wea00610");
    expect(placeholderLabel("tv remote couch night")).toBe("tv remote couch night");
  });
  it("ranks tiny stock images last", () => {
    const lic = { name: "CC0", commercialUse: true, requiresAttribution: false };
    const c = (id: string, w: number) => ({ id, kind: "image" as const, url: `https://x.test/${id}`, width: w, height: Math.round(w * 0.7), description: `File:Ray Tomlinson ${id}.jpg`, provider: "t", license: lic });
    expect(rankCandidates([c("tiny", 318), c("big", 1123)], "Ray Tomlinson").map((x) => x.id)).toEqual(["big", "tiny"]);
  });
  it("brief defaults are sane", () => {
    const b = VideoBrief.parse({ topic: "x y z" });
    expect(b.aspect).toBe("9:16");
    expect(b.voice.targetWpm).toBe(170);
  });
});

describe("poster", () => {
  it("highlights stressed words, then numbers, then the last word", () => {
    expect(posterFor("Your Jeans Have a Patent", "", ["patented", "rivets"], 0.6, 30).highlight).toEqual(["Patent"]);
    expect(posterFor("The @ Sign Is 500 Years Old", "", ["wine"], 0.6, 30).highlight).toEqual(["500"]);
    expect(posterFor("Barcodes Began in the Sand", "", [], 0.6, 30).highlight).toEqual(["Sand"]);
  });
  it("renders a clean main cut plus a poster variant by default", async () => {
    const storage = new MemoryStorage();
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, handle: "@hiddeninplainsight.tv" }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage, jobId: "p1", stopAfter: "compose" });
    // main cut opens straight into the hook
    expect(res.project!.files["compositions/poster.html"]).toBeUndefined();
    expect(res.project!.files["index.html"]).not.toContain('id="poster"');
    // the variant carries the poster
    expect(res.manifest.outputs.variants?.poster?.projectKey).toBe("jobs/p1/project-poster/");
    const index = await storage.getText("jobs/p1/project-poster/index.html");
    expect(index).toMatch(/id="poster"[^>]*data-start="0"[^>]*data-duration="0\.6"/);
    const poster = (await storage.getText("jobs/p1/project-poster/compositions/poster.html"))!;
    expect(poster).toContain("DID YOU KNOW?");
    expect(poster).toContain('class="pst-hl"');
    expect(poster).toContain("@hiddeninplainsight.tv");
    expect(poster).toContain("data-layout-ignore");
    // visible at frame 0: no entrance tween, only the exit
    expect(poster).not.toMatch(/\{opacity:0[^}]*\}, \{opacity:1/);
  });
  it("honours poster modes off and on", async () => {
    const run = (poster: { mode?: "off" | "on"; enabled?: boolean }, jobId: string) =>
      runPipeline({ topic: "the floppy disk save icon", durationSec: 25, poster }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId, stopAfter: "compose" });
    const off = await run({ mode: "off" }, "p2");
    expect(off.project!.files["compositions/poster.html"]).toBeUndefined();
    expect(off.manifest.outputs.variants?.poster).toBeUndefined();
    const on = await run({ enabled: true }, "p3");
    expect(on.project!.files["compositions/poster.html"]).toBeDefined();
    expect(on.manifest.outputs.variants?.poster).toBeUndefined();
  });
});

describe("icons and versus cards", () => {
  it("resolves hand-drawn, Lucide and alias names; unknown names get a neutral icon", () => {
    expect(resolveIcon("power")).toEqual(ICONS.power);
    expect(resolveIcon("Bug")!.length).toBeGreaterThan(3);
    expect(resolveIcon("scroll text")).toEqual(resolveIcon("scroll-text"));
    expect(resolveIcon("moth")).toEqual(resolveIcon("bug"));
    expect(resolveIcon("definitely-not-an-icon")).toBeNull();
    const svg = iconSvg("definitely-not-an-icon", "i1", { size: 64, color: "#fff" });
    expect(svg).not.toContain(ICONS.power![0]!);
    // every primitive is a path so the draw-on works
    expect(iconSvg("traffic-cone", "i2", { size: 64, color: "#fff" })).not.toMatch(/<(circle|rect|line|polyline|polygon|ellipse)\b/);
  });
  it("renders a versus card with a photo side and an icon side", async () => {
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, poster: { mode: "off" } }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId: "v1", stopAfter: "compose" });
    const tl = structuredClone(res.timeline!);
    const i = tl.scenes.findIndex((s) => s.id === "sh5");
    tl.scenes[i] = { ...tl.scenes[i]!, assets: ["sh5-L"], scene: { type: "versus", left: { asset: { kind: "image", query: "8 inch floppy", prefer: "either" }, title: "1971", label: "8-inch floppy" }, right: { icon: "save", title: "TODAY", label: "The save icon" }, winner: "right" } };
    const assets = [...res.manifest.assets, { id: "sh5-L", kind: "image" as const, uri: "store://x/sh5-L.jpg", mime: "image/jpeg", width: 1600, height: 1200, provider: "t", license: { name: "CC0", commercialUse: true, requiresAttribution: false }, role: "visual" as const }];
    const p = compileHyperFrames(tl, { assets, style: framedExplainer, aspect: "9:16" });
    const html = p.files["compositions/s-sh5.html"]!;
    expect(html).toContain('src="assets/img/sh5-L.jpg"');
    expect(html).toContain("vs-vx-hot");
    expect(html).toContain(">1971<");
    expect(html).toContain(">VS<");
    expect(p.assetPaths["assets/img/sh5-L.jpg"]).toBeDefined();
  });
  it("keeps the requested part of a tall photo in frame", async () => {
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, poster: { mode: "off" } }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId: "v3", stopAfter: "compose" });
    const tl = structuredClone(res.timeline!);
    const i = tl.scenes.findIndex((s) => s.id === "sh5");
    tl.scenes[i] = { ...tl.scenes[i]!, assets: ["sh5-a"], scene: { type: "broll", asset: { kind: "image", query: "portrait", prefer: "either" }, treatment: "natural", move: "pushIn", focusY: 0.2 } };
    const assets = [...res.manifest.assets, { id: "sh5-a", kind: "image" as const, uri: "store://x/sh5-a.jpg", mime: "image/jpeg", width: 1200, height: 2400, provider: "t", license: { name: "CC0", commercialUse: true, requiresAttribution: false }, role: "visual" as const }];
    const html = compileHyperFrames(tl, { assets, style: framedExplainer, aspect: "9:16" }).files["compositions/s-sh5.html"]!;
    expect(html).toMatch(/<img id="s-sh5-a-m"[^>]*style="object-position:50% 20%"/);
  });
  it("shrinks versus titles so long words fit their cards", async () => {
    const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, poster: { mode: "off" } }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId: "v2", stopAfter: "compose" });
    const size = (left: string, right: string) => {
      const tl = structuredClone(res.timeline!);
      const i = tl.scenes.findIndex((s) => s.id === "sh5");
      tl.scenes[i] = { ...tl.scenes[i]!, scene: { type: "versus", left: { title: left, label: "a" }, right: { title: right, label: "b" }, winner: "right" } };
      const html = compileHyperFrames(tl, { assets: res.manifest.assets, style: framedExplainer, aspect: "9:16" }).files["compositions/s-sh5.html"]!;
      const px = [...html.matchAll(/vs-vx-title[^"]*" style="font-size:(\d+)px"/g)].map((m) => Number(m[1]));
      expect(px[0]).toBe(px[1]);
      return px[0]!;
    };
    const short = size("3", "2");
    const long = size("LABOŘI", "DÍA DE MUERTOS");
    expect(long).toBeLessThan(short);
    expect(long * 14 * 0.66).toBeLessThan(1080 * 0.94 / 2);
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
    // the scale pop is a short pulse, so long or emphasised words don't eat the gap
    expect(p2.files["compositions/captions.html"]).toContain("{scale:1.08}, {scale:1, duration:0.08");
  });
});
