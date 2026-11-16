/**
 * Motion core: physical easing, motion rules and a text animator for HyperFrames scenes.
 *
 * The spring maths, curve values and motion rules are adapted from Crewcut
 * (https://github.com/codewithveek/crewcut, packages/motion), Apache License 2.0,
 * which in turn follows Apple's spring parameters and Emil Kowalski's motion rules:
 *  - springs in two numbers: damping ratio ζ and response (seconds); critically damped by default
 *  - entrances ease out, moves ease in-out, exits leave the way they came
 *  - nothing appears from nothing: enter from scale 0.9–0.95
 *  - entrances 400–700 ms, list stagger 40–80 ms, crossfade blur 2–8 px (never above 20)
 *
 * Scenes are GSAP timelines, so every curve is registered as a named GSAP ease
 * (`vs-entrance`, `vs-spring-smooth`, …) by MOTION_RUNTIME, a small script that each
 * composition carries. Springs are normalised over their settle time: a tween using
 * `vs-spring-smooth` should last `springSeconds("smooth")` (see `springTween`).
 */
import { escapeHtml as e, round3 } from "../util.js";

/* ------------------------------ springs ------------------------------ */

export interface AppleSpring {
  /** ζ. 1 = critically damped (no overshoot); ~0.8 implies momentum. */
  dampingRatio: number;
  /** Seconds to (approximately) reach the target. */
  response: number;
}

export const SPRINGS = {
  snappy: { dampingRatio: 1, response: 0.35 },
  smooth: { dampingRatio: 1, response: 0.45 },
  gentle: { dampingRatio: 1, response: 0.6 },
  momentum: { dampingRatio: 0.8, response: 0.5 },
  bouncy: { dampingRatio: 0.65, response: 0.55 },
} as const satisfies Record<string, AppleSpring>;
export type SpringName = keyof typeof SPRINGS;

/** Closed-form step response of a damped oscillator released from 0 towards 1 (overshoots when ζ < 1). */
export function springProgress(s: AppleSpring, t: number): number {
  if (t <= 0) return 0;
  const w = (Math.PI * 2) / s.response;
  const z = s.dampingRatio;
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w * t) * (1 + w * t);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  const r = Math.sqrt(z * z - 1);
  const a = -w * (z - r);
  const b = -w * (z + r);
  return 1 + (b * Math.exp(a * t) - a * Math.exp(b * t)) / (a - b);
}

/** Seconds until the spring stays within `tolerance` of its target (rounded to 10 ms). */
export function springSeconds(name: SpringName, tolerance = 0.004): number {
  const s = SPRINGS[name];
  let last = 0;
  for (let t = 0; t <= s.response * 6; t += 1 / 240) if (Math.abs(1 - springProgress(s, t)) > tolerance) last = t;
  return Math.ceil((last + 1 / 240) * 100) / 100;
}

/* ------------------------------ curves ------------------------------- */

/** Named curves (cubic-bezier control points). Never use an ease-in for an entrance. */
export const CURVES = {
  entrance: [0.23, 1, 0.32, 1],
  move: [0.77, 0, 0.175, 1],
  exit: [0.32, 0, 0.67, 0],
  standard: [0.4, 0, 0.2, 1],
} as const;
export type CurveName = keyof typeof CURVES;

/** Cubic-bezier easing (CSS semantics): x is time, y is progress. */
export function cubicBezier([x1, y1, x2, y2]: readonly number[]): (p: number) => number {
  const cx = 3 * x1!, bx = 3 * (x2! - x1!) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1!, by = 3 * (y2! - y1!) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - p;
      const d = dx(t);
      if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - p) > 1e-4) {
      let lo = 0, hi = 1;
      t = p;
      for (let i = 0; i < 30; i++) {
        if (sx(t) < p) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

/** GSAP ease name for a curve or spring. */
export const ease = (name: CurveName | `spring-${SpringName}`) => `vs-${name}`;

/** A spring tween's duration and ease, e.g. `duration:${t.dur}, ease:"${t.ease}"`. */
export function springTween(name: SpringName): { dur: number; ease: string } {
  return { dur: springSeconds(name), ease: ease(`spring-${name}`) };
}

/* ------------------------------ rules -------------------------------- */

export const MOTION_RULES = {
  entranceMinSec: 0.4,
  entranceMaxSec: 0.7,
  staggerMinSec: 0.04,
  staggerMaxSec: 0.08,
  enterScaleMin: 0.9,
  enterScaleMax: 0.95,
  crossfadeBlurMinPx: 2,
  crossfadeBlurMaxPx: 8,
  blurCeilingPx: 20,
} as const;

export const clampStagger = (s: number) => Math.min(MOTION_RULES.staggerMaxSec, Math.max(MOTION_RULES.staggerMinSec, s));

/**
 * Narration-led pacing (Crewcut's solver): calm videos hold each layout long enough
 * to read, then breathe before the next one.
 */
export const NARRATION_PACING = { firstLeadSec: 0.35, leadSec: 0.25, gapSec: 0.18, tailSec: 0.6, minSceneSec: 2.2 } as const;

/* --------------------------- GSAP runtime ---------------------------- */

/**
 * Registers the named eases with GSAP once per page. Carried by index.html and every
 * composition, so a sub-composition previewed on its own still resolves its eases.
 */
export const MOTION_RUNTIME = (() => {
  const springs = Object.entries(SPRINGS)
    .map(([k, s]) => `["${k}",${s.dampingRatio},${s.response},${springSeconds(k as SpringName)}]`)
    .join(",");
  const curves = Object.entries(CURVES)
    .map(([k, c]) => `["${k}",[${c.join(",")}]]`)
    .join(",");
  return `(function(){if(typeof gsap==="undefined"||window.__vsMotion)return;window.__vsMotion=1;
function sp(z,r,t){if(t<=0)return 0;var w=Math.PI*2/r;if(Math.abs(z-1)<1e-6)return 1-Math.exp(-w*t)*(1+w*t);if(z<1){var wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*t)*(Math.cos(wd*t)+(z*w/wd)*Math.sin(wd*t));}var q=Math.sqrt(z*z-1),a=-w*(z-q),b=-w*(z+q);return 1+(b*Math.exp(a*t)-a*Math.exp(b*t))/(a-b);}
function bz(c){var x1=c[0],y1=c[1],x2=c[2],y2=c[3],cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;function X(t){return((ax*t+bx)*t+cx)*t}function Y(t){return((ay*t+by)*t+cy)*t}function D(t){return(3*ax*t+2*bx)*t+cx}return function(p){if(p<=0)return 0;if(p>=1)return 1;var t=p,i;for(i=0;i<8;i++){var er=X(t)-p,d=D(t);if(Math.abs(er)<1e-6||Math.abs(d)<1e-6)break;t-=er/d;}if(t<0||t>1||Math.abs(X(t)-p)>1e-4){var lo=0,hi=1;t=p;for(i=0;i<30;i++){if(X(t)<p)lo=t;else hi=t;t=(lo+hi)/2;}}return Y(t);};}
[${curves}].forEach(function(c){gsap.registerEase("vs-"+c[0],bz(c[1]));});
[${springs}].forEach(function(s){gsap.registerEase("vs-spring-"+s[0],function(p){return p>=1?1:sp(s[1],s[2],p*s[3]);});});
})();`;
})();

/* --------------------------- text animator --------------------------- */

export type TextUnit = "word" | "line" | "char";
export type TextPreset = "fade-rise" | "mask-rise" | "blur-in" | "scale-in";

/**
 * Text → HTML split into animation units. `*word*` marks an accent span (class vs-acc),
 * `\n` breaks lines. Every unit is a `.vs-u` span inside the element `id`; mask-rise
 * wraps each unit in a clipping `.vs-um` so it rises out of its own line.
 */
export function splitText(id: string, text: string, opts: { unit?: TextUnit; preset?: TextPreset; cls?: string } = {}): string {
  const unit = opts.unit ?? "word";
  const mask = opts.preset === "mask-rise";
  const wrap = (inner: string) => (mask ? `<span class="vs-um">${inner}</span>` : inner);
  const lines = text.split("\n").map((line) => {
    const parts: { t: string; acc: boolean }[] = [];
    line.split(/(\*[^*]+\*)/).forEach((seg) => {
      if (!seg) return;
      const acc = /^\*[^*]+\*$/.test(seg);
      parts.push({ t: acc ? seg.slice(1, -1) : seg, acc });
    });
    if (unit === "line") {
      const inner = parts.map((p) => (p.acc ? `<span class="vs-acc">${e(p.t)}</span>` : e(p.t))).join("");
      return `<span class="vs-line">${wrap(`<span class="vs-u">${inner}</span>`)}</span>`;
    }
    const out: string[] = [];
    parts.forEach((p) => {
      p.t.split(/(\s+)/).forEach((tok) => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) return out.push(" ");
        const body =
          unit === "char"
            ? `<span class="vs-wd">${[...tok].map((ch) => wrap(`<span class="vs-u">${e(ch)}</span>`)).join("")}</span>`
            : wrap(`<span class="vs-u">${e(tok)}</span>`);
        out.push(p.acc ? `<span class="vs-acc">${body}</span>` : body);
      });
    });
    return `<span class="vs-line">${out.join("")}</span>`;
  });
  return `<div id="${id}" class="vs-text${opts.cls ? ` ${opts.cls}` : ""}">${lines.join("")}</div>`;
}

/** Start/end states per preset (GSAP vars). Scale never starts below 0.9. */
const PRESET_FROM: Record<TextPreset, string> = {
  "fade-rise": `opacity:0, yPercent:45`,
  "mask-rise": `yPercent:110`,
  "blur-in": `opacity:0, filter:"blur(0.14em)"`,
  "scale-in": `opacity:0, scale:0.9`,
};
const PRESET_TO: Record<TextPreset, string> = {
  "fade-rise": `opacity:1, yPercent:0`,
  "mask-rise": `yPercent:0`,
  "blur-in": `opacity:1, filter:"blur(0em)"`,
  "scale-in": `opacity:1, scale:1`,
};

/** GSAP for a split text's entrance: units stagger 40–80 ms on an ease-out curve or a critically damped spring. */
export function textIn(
  id: string,
  at: number,
  opts: { preset?: TextPreset; stagger?: number; dur?: number; ease?: string } = {},
): string {
  const preset = opts.preset ?? "fade-rise";
  const stagger = clampStagger(opts.stagger ?? 0.06);
  const dur = opts.dur ?? 0.56;
  const easeName = opts.ease ?? ease("entrance");
  return `tl.fromTo("#${id} .vs-u", {${PRESET_FROM[preset]}}, {${PRESET_TO[preset]}, duration:${round3(dur)}, ease:"${easeName}", stagger:${round3(stagger)}}, ${round3(at)});`;
}

/** Exit the way it came (mirrored path, eased in), all units together. */
export function textOut(id: string, at: number, opts: { preset?: TextPreset; dur?: number } = {}): string {
  const preset = opts.preset ?? "fade-rise";
  return `tl.fromTo("#${id} .vs-u", {${PRESET_TO[preset]}}, {${PRESET_FROM[preset]}, duration:${round3(opts.dur ?? 0.36)}, ease:"${ease("exit")}", immediateRender:false}, ${round3(at)});`;
}

/** Blur-out exit for a whole block (the reference's dissolve between layouts). */
export function blurOut(sel: string, at: number, dur = 0.4): string {
  return `tl.fromTo("${sel}", {opacity:1, filter:"blur(0px)"}, {opacity:0, filter:"blur(${MOTION_RULES.crossfadeBlurMaxPx}px)", duration:${round3(dur)}, ease:"${ease("exit")}", immediateRender:false}, ${round3(at)});`;
}

/** Block entrance: opacity + rise or scale from 0.94 on a spring (never from 0). */
export function blockIn(sel: string, at: number, kind: "rise" | "scale" | "blur" = "rise"): string {
  const sp = springTween("smooth");
  if (kind === "scale")
    return `tl.fromTo("${sel}", {opacity:0, scale:0.94}, {opacity:1, scale:1, duration:${sp.dur}, ease:"${sp.ease}"}, ${round3(at)});`;
  if (kind === "blur")
    return `tl.fromTo("${sel}", {opacity:0, filter:"blur(6px)", scale:0.96}, {opacity:1, filter:"blur(0px)", scale:1, duration:0.64, ease:"${ease("entrance")}"}, ${round3(at)});`;
  return `tl.fromTo("${sel}", {opacity:0, y:36}, {opacity:1, y:0, duration:${sp.dur}, ease:"${sp.ease}"}, ${round3(at)});`;
}

/** CSS shared by split text (accent colour comes from the caller). */
export function textCss(accent: string): string {
  return `.vs-text{white-space:normal;}.vs-line{display:block;}.vs-u{display:inline-block;will-change:transform,opacity;}.vs-um{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.12em;margin-bottom:-.12em;}.vs-wd{display:inline-block;white-space:nowrap;}.vs-acc{color:${accent};}`;
}

/* ------------------------------ ambient ------------------------------ */

/**
 * A soft radial glow that drifts slowly (finite repeats, so seeking stays deterministic).
 * Returns markup + tweens; place it first so it sits behind the content.
 */
export function glow(id: string, opts: { color: string; x: number; y: number; size: number; dur: number; drift?: number; opacity?: number }): { html: string; js: string } {
  const d = opts.drift ?? 40;
  const half = 3.5;
  const halves = Math.max(1, Math.ceil(opts.dur / half));
  const html = `<div id="${id}" class="vs-glow" style="left:${Math.round(opts.x - opts.size / 2)}px;top:${Math.round(opts.y - opts.size / 2)}px;width:${Math.round(opts.size)}px;height:${Math.round(opts.size)}px;background:radial-gradient(circle, ${opts.color} 0%, transparent 68%);opacity:${opts.opacity ?? 0.55};"></div>`;
  const js = `tl.fromTo("#${id}", {x:${-d}, y:${Math.round(d * 0.6)}}, {x:${d}, y:${-Math.round(d * 0.6)}, duration:${half}, ease:"sine.inOut", yoyo:true, repeat:${halves - 1}}, 0);`;
  return { html, js };
}

export const GLOW_CSS = `.vs-glow{position:absolute;border-radius:50%;pointer-events:none;}`;
