import { describe, expect, it } from "vitest";
import { MemoryStorage, Scene, compileHyperFrames, editorial, getStyle, runPipeline, synthPad, wavDuration } from "../src/index.js";
import type { Asset, Timeline } from "../src/index.js";
import { fakeLLM, fakeTTS } from "./fixtures.js";

const photo = (id: string): Asset => ({ id, kind: "image", uri: `store://x/${id}.jpg`, mime: "image/jpeg", width: 2000, height: 3000, provider: "pexels", license: { name: "Pexels License", commercialUse: true, requiresAttribution: false }, role: "visual" });

/** A compiled timeline whose scenes are replaced by the given editorial scenes, one per scene slot. */
async function compileWith(scenes: unknown[], opts: { start?: number } = {}) {
  const res = await runPipeline({ topic: "the floppy disk save icon", durationSec: 25, style: "editorial", poster: { mode: "off" } }, { providers: { llm: fakeLLM(), tts: fakeTTS() }, storage: new MemoryStorage(), jobId: `ed${Math.random()}`, stopAfter: "compose" });
  const tl: Timeline = structuredClone(res.timeline!);
  const assets: Asset[] = [...res.manifest.assets];
  scenes.forEach((sc, i) => {
    const parsed = Scene.parse(sc);
    const slot = tl.scenes[i]!;
    const hasAsset = "asset" in parsed && parsed.asset;
    if (hasAsset) assets.push(photo(`${slot.id}-a`));
    tl.scenes[i] = { ...slot, ...(i === 0 && opts.start !== undefined ? { start: opts.start } : {}), assets: hasAsset ? [`${slot.id}-a`] : [], scene: parsed };
  });
  return { p: compileHyperFrames(tl, { assets, style: editorial, aspect: "9:16", poster: false }), tl };
}

describe("editorial style", () => {
  it("is registered with bundled fonts, phrase captions and a blur crossfade", () => {
    const s = getStyle("editorial");
    expect(s.fonts.faces).toContain('font-family:"Fraunces"');
    expect(s.fonts.faces).toContain("data:font/woff2;base64,");
    expect(s.captions.mode).toBe("phrase");
    expect(s.motion.transition?.type).toBe("blur-crossfade");
    expect(s.layout("9:16").title).toBeUndefined();
  });

  it("renders hero, statement, bignum, ranked and checklist layouts", async () => {
    const img = { kind: "image", query: "pexels:1", prefer: "stock" };
    const { p, tl } = await compileWith([
      { type: "hero", asset: img, eyebrow: "THE SCIENCE OF YOU", headline: "Your *yawn* knows\nwho you love" },
      { type: "statement", lines: ["Yawns are *contagious*.", "Some catch them far more."], newFrom: 1, join: true },
      { type: "bignum", value: "109", label: "adults", cite: "Norscia & Palagi (2011)", asset: img },
      { type: "ranked", title: "WHO CATCHES IT FIRST", items: [{ label: "Family" }, { label: "Friends" }, { label: "Strangers", note: "least" }], asset: img },
      { type: "checklist", items: [{ label: "Gender", ok: false }, { label: "Closeness", ok: true }] },
    ]);
    const f = (i: number) => p.files[`compositions/s-${tl.scenes[i]!.id}.html`.replace(/[^a-zA-Z0-9_/.-]/g, "-")]!;
    // hero: photo + serif headline split into units with the accent word
    expect(f(0)).toContain("ed-media");
    expect(f(0)).toContain(`<span class="vs-acc"><span class="vs-u">yawn</span></span>`);
    expect(f(0)).toContain("THE SCIENCE OF YOU");
    // statement: the earlier line is already on screen (only line 1 animates)
    expect(f(1)).toContain(`-l1 .vs-u`);
    expect(f(1)).not.toContain(`-l0 .vs-u`);
    // bignum counts up from 0 with a snap, shows its citation
    expect(f(2)).toMatch(/textContent:109, snap:\{textContent:1\}/);
    expect(f(2)).toContain("Norscia &amp; Palagi (2011)");
    // ranked: numbered rows, note on the last row
    expect(f(3)).toContain(">01<");
    expect(f(3)).toContain(">least<");
    // checklist: brush check and cross marks with draw-on masks
    expect(f(4)).toContain('pathLength="1"');
    expect(f(4)).toContain('"stroke-dashoffset":0');
    // eases come from the motion runtime carried by every scene
    expect(f(0)).toContain('registerEase("vs-"');
    // a joined shot does not fade in, every other later shot does
    expect(f(1)).not.toMatch(/-xf", \{opacity:0, filter:"blur/);
    expect(f(2)).toMatch(/-xf", \{opacity:0, filter:"blur/);
  });

  it("draws the opening hero fully at frame 0 (it is the cover)", async () => {
    const { p, tl } = await compileWith([{ type: "hero", asset: { kind: "image", query: "pexels:1", prefer: "stock" }, headline: "Your *yawn* knows who you love" }], { start: 0 });
    const html = p.files[`compositions/s-${tl.scenes[0]!.id}.html`]!;
    expect(html).not.toMatch(/-h \.vs-u", \{opacity:0/);
  });

  it("captions in phrase mode keep key words lit and skip the outline", async () => {
    const { p } = await compileWith([]);
    const cap = p.files["compositions/captions.html"]!;
    expect(cap).not.toContain("-webkit-text-stroke");
    expect(cap).not.toMatch(/\{color:"#FFB35C"\}, \{color:"#FFFFFF"/);
  });

  it("synthesises a quiet, deterministic music bed of the requested length", () => {
    const a = synthPad(12);
    const b = synthPad(12);
    expect(wavDuration(a.bytes)).toBeCloseTo(12, 1);
    expect(a.bytes).toEqual(b.bytes);
  });
});
