import { describe, expect, it } from "vitest";
import {
  CURVES,
  MOTION_RULES,
  MOTION_RUNTIME,
  SPRINGS,
  blockIn,
  clampStagger,
  crossfadeJs,
  cubicBezier,
  glow,
  splitText,
  springProgress,
  springSeconds,
  springTween,
  textIn,
  textOut,
} from "../src/index.js";

/** Runs MOTION_RUNTIME against a fake gsap and returns the registered eases. */
function runtimeEases(): Record<string, (p: number) => number> {
  const eases: Record<string, (p: number) => number> = {};
  const win: Record<string, unknown> = {};
  new Function("gsap", "window", MOTION_RUNTIME)({ registerEase: (n: string, f: (p: number) => number) => (eases[n] = f) }, win);
  return eases;
}

describe("motion core", () => {
  it("springs settle at 1; critically damped ones never overshoot, momentum does", () => {
    for (const [name, s] of Object.entries(SPRINGS)) {
      expect(Math.abs(1 - springProgress(s, s.response * 4))).toBeLessThan(0.01);
      const peak = Math.max(...Array.from({ length: 200 }, (_, i) => springProgress(s, (i / 200) * s.response * 3)));
      if (s.dampingRatio >= 1) expect(peak).toBeLessThanOrEqual(1.000001);
      else expect(peak, name).toBeGreaterThan(1.01);
    }
    expect(springSeconds("smooth")).toBeGreaterThan(0.3);
    expect(springSeconds("smooth")).toBeLessThan(0.7);
  });

  it("matches CSS cubic-bezier: entrance is ease-out, exit is ease-in", () => {
    const enter = cubicBezier(CURVES.entrance);
    const exit = cubicBezier(CURVES.exit);
    expect(enter(0)).toBe(0);
    expect(enter(1)).toBe(1);
    expect(enter(0.25)).toBeGreaterThan(0.6); // fast start
    expect(exit(0.25)).toBeLessThan(0.15); // slow start
    // monotonic
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = enter(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("the page runtime registers the same curves and springs the compiler uses", () => {
    const eases = runtimeEases();
    for (const k of Object.keys(CURVES)) expect(eases[`vs-${k}`]).toBeTypeOf("function");
    const enter = cubicBezier(CURVES.entrance);
    for (const p of [0.1, 0.3, 0.5, 0.9]) expect(eases["vs-entrance"]!(p)).toBeCloseTo(enter(p), 5);
    const t = springTween("smooth");
    expect(eases[t.ease]).toBeTypeOf("function");
    for (const p of [0.2, 0.5, 0.8]) expect(eases[t.ease]!(p)).toBeCloseTo(springProgress(SPRINGS.smooth, p * t.dur), 6);
    expect(eases[t.ease]!(1)).toBe(1);
  });

  it("splits text into units, keeps *accent* spans and line breaks", () => {
    const html = splitText("h", "Who made you\n*yawn* last?", { unit: "word" });
    expect(html.match(/class="vs-u"/g)).toHaveLength(5);
    expect(html.match(/class="vs-line"/g)).toHaveLength(2);
    expect(html).toContain(`<span class="vs-acc"><span class="vs-u">yawn</span></span>`);
    const masked = splitText("h", "One line\nTwo", { unit: "line", preset: "mask-rise" });
    expect(masked.match(/class="vs-um"/g)).toHaveLength(2);
    expect(splitText("h", "<b>&", {})).not.toContain("<b>");
  });

  it("entrances follow the rules: ease-out, clamped stagger, scale from ≥ 0.9; exits mirror", () => {
    const js = textIn("h", 0.2, { preset: "scale-in", stagger: 0.2 });
    expect(js).toContain(`stagger:${MOTION_RULES.staggerMaxSec}`);
    expect(js).toContain("scale:0.9");
    expect(js).toContain(`ease:"vs-entrance"`);
    expect(clampStagger(0.01)).toBe(MOTION_RULES.staggerMinSec);
    const out = textOut("h", 3, { preset: "fade-rise" });
    expect(out).toContain(`ease:"vs-exit"`);
    expect(out).toContain("immediateRender:false");
    expect(blockIn("#x", 0, "scale")).toContain("scale:0.94");
  });

  it("crossfade blur stays within the 2–8 px rule; glow repeats are finite", () => {
    const js = crossfadeJs("s1", 0.5, 4, 0.5);
    const px = [...js.matchAll(/blur\((\d+)px\)/g)].map((m) => Number(m[1]));
    expect(Math.max(...px)).toBeLessThanOrEqual(MOTION_RULES.crossfadeBlurMaxPx);
    expect(Math.max(...px)).toBeGreaterThanOrEqual(MOTION_RULES.crossfadeBlurMinPx);
    const g = glow("g", { color: "#ff8a5b", x: 540, y: 600, size: 900, dur: 20 });
    expect(g.js).toMatch(/repeat:\d+/);
    expect(g.js).not.toContain("repeat:-1");
  });
});
