/**
 * Editorial scenes for vertical "science of you" explainers: a photo hero with a serif
 * headline, stacked statements that build line by line, a big number with its citation,
 * a ranked list under a photo card, and a ✓/✗ checklist with hand-drawn brush marks.
 *
 * Layout (1080×1920, scaled by width): text keeps a 72 px gutter, nothing sits in the top
 * ~5 % (platform chrome) or below ~80 % (captions and platform buttons; captions own
 * 74–80 %). Motion follows ./motion.ts: entrances ease out or settle on critically damped
 * springs, start from ≥ 0.9 scale, and stagger 40–80 ms.
 */
import type { TimedScene } from "../spec.js";
import { escapeHtml as e, hashString, round3 } from "../util.js";
import { GLOW_CSS, blockIn, ease, glow, splitText, springTween, textCss, textIn } from "./motion.js";
import { mediaTag, moveTween, registerRenderer, type SceneAsset, type SceneCtx, type SceneOutput } from "./scenes.js";

const n = (v: number) => round3(v);
type S<T extends string> = Extract<TimedScene["scene"], { type: T }>;

/* ------------------------------ brush marks ------------------------------ */

/**
 * Hand-drawn check (no circle): a short thick stroke, a rounded heel, then a long stroke
 * that tapers to a point. Revealed by a round-capped mask stroke drawn along its centre line.
 */
const CHECK_FILL = "M10 50 C16 45 24 45 28 51 L39 67 C52 43 70 21 94 9 C74 30 56 54 44 84 C42 89 35 90 31 85 Z";
const CHECK_PATH = "M17 53 L36 80 L91 13";
const CROSS_FILLS = ["M14 18 C18 12 26 13 30 18 L86 80 C89 85 85 90 80 88 Z", "M80 12 C86 14 88 20 84 24 L22 88 C18 91 12 87 15 82 Z"];
const CROSS_PATHS = ["M20 18 L84 84", "M82 16 L18 84"];

export function brushMark(id: string, ok: boolean, color: string, size: number): string {
  const fills = ok ? [CHECK_FILL] : CROSS_FILLS;
  const paths = ok ? [CHECK_PATH] : CROSS_PATHS;
  const masks = paths
    .map((d, i) => `<mask id="${id}-m${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><path id="${id}-p${i}" d="${d}" pathLength="1" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="0"/></mask>`)
    .join("");
  const shapes = fills.map((d, i) => `<path d="${d}" fill="${color}" mask="url(#${id}-m${ok ? 0 : i})"/>`).join("");
  return `<svg id="${id}" class="ed-mark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs>${masks}</defs>${shapes}</svg>`;
}

/** Draw the mark on (pen-flick timing), then settle it from 0.9 on a snappy spring. */
export function brushDraw(id: string, ok: boolean, at: number): string {
  const sp = springTween("snappy");
  let js = "";
  if (ok) js += `tl.fromTo("#${id}-p0", {attr:{"stroke-dashoffset":1}}, {attr:{"stroke-dashoffset":0}, duration:0.38, ease:"${ease("entrance")}"}, ${n(at)});`;
  else {
    js += `tl.fromTo("#${id}-p0", {attr:{"stroke-dashoffset":1}}, {attr:{"stroke-dashoffset":0}, duration:0.2, ease:"${ease("entrance")}"}, ${n(at)});`;
    js += `tl.fromTo("#${id}-p1", {attr:{"stroke-dashoffset":1}}, {attr:{"stroke-dashoffset":0}, duration:0.2, ease:"${ease("entrance")}"}, ${n(at + 0.14)});`;
  }
  js += `tl.fromTo("#${id}", {scale:0.9}, {scale:1, duration:${sp.dur}, ease:"${sp.ease}"}, ${n(at)});`;
  return js;
}

/* --------------------------------- shared -------------------------------- */

function k(ctx: SceneCtx) {
  return ctx.width / 1080;
}

/** Page CSS shared by every editorial scene (each scene file carries its own copy). */
function pageCss(ctx: SceneCtx): string {
  const p = ctx.style.palette;
  const f = ctx.style.fonts;
  const K = k(ctx);
  const px = (v: number) => `${Math.round(v * K)}px`;
  return `${textCss(p.accent)}${GLOW_CSS}
.ed-page{position:absolute;inset:0;background:radial-gradient(ellipse at 60% 35%,${p.card} 0%,${p.bg} 70%);}
.ed-serif{font-family:"${f.display}",Georgia,serif;font-weight:600;letter-spacing:-.012em;color:var(--vs-ink);}
.ed-eyebrow{font:500 ${px(30)}/1 "${f.mono}",monospace;letter-spacing:.22em;text-transform:uppercase;color:var(--vs-accent);}
.ed-rule{width:${px(64)};height:${px(5)};border-radius:${px(3)};background:var(--vs-accent);}
.ed-body{font:500 ${px(34)}/1.3 "${f.ui}",sans-serif;color:var(--vs-ink);}
.ed-cite{font:500 ${px(27)}/1.3 "${f.mono}",monospace;letter-spacing:.04em;color:var(--vs-muted);}
.ed-italic{font-style:italic;color:var(--vs-accent);}
.ed-media{position:absolute;overflow:hidden;}
.ed-media .vs-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.ed-mz{position:absolute;inset:0;}
.ed-card{border-radius:${px(34)};box-shadow:0 ${px(30)} ${px(70)} rgba(0,0,0,.55);background:${p.card};}
.ed-mark{display:block;overflow:visible;}`;
}

/** Media (image or video) inside a positioned box, with a slow camera move on an inner wrapper. */
function mediaBox(ctx: SceneCtx, key: string, a: SceneAsset | undefined, box: { x: number; y: number; w: number; h: number }, opts: { cls?: string; focusY?: number; move?: string } = {}): { html: string; js: string } {
  const id = `${ctx.sid}-${key}`;
  const dur = ctx.ts.duration;
  const inner = mediaTag(`${id}-m`, a, dur, "vs-media", 0, opts.focusY);
  const html = `<div id="${id}" class="ed-media${opts.cls ? ` ${opts.cls}` : ""}" style="left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${Math.round(box.w)}px;height:${Math.round(box.h)}px;"><div id="${id}-mz" class="ed-mz">${inner}</div></div>`;
  return { html, js: moveTween(`#${id}-mz`, opts.move ?? "pushIn", dur, hashString(ctx.sid)) };
}

/** Faint, pre-blurred full-frame backdrop (rendered by ffmpeg, so no CSS blur on footage). */
function backdrop(ctx: SceneCtx, a: SceneAsset | undefined, dim: number): { html: string; js: string } {
  if (!a) return { html: "", js: "" };
  const blurred = ctx.derive(a, "blur-bg");
  const src = blurred ? { path: blurred, asset: a.asset } : a;
  const box = mediaBox(ctx, "bd", src, { x: 0, y: 0, w: ctx.width, h: ctx.height }, { move: "kenBurns" });
  return { html: `${box.html}<div class="vs-layer" style="background:rgba(0,0,0,${dim});"></div>`, js: box.js };
}

function sceneGlow(ctx: SceneCtx, x: number, y: number, size: number): { html: string; js: string } {
  return glow(`${ctx.sid}-glow`, { color: `${ctx.style.palette.accent}55`, x: x * ctx.width, y: y * ctx.height, size: size * ctx.width, dur: ctx.ts.duration, drift: Math.round(40 * k(ctx)) });
}

/** Font size that keeps a serif headline within `maxLines` at the given width (Fraunces ≈ 0.5 em per glyph). */
function fitSerif(text: string, maxW: number, base: number, maxLines: number): number {
  const longest = Math.max(...text.replace(/\*/g, "").split("\n").map((l) => l.length));
  const totalLines = text.split("\n").length;
  const perLine = Math.max(longest / Math.max(1, maxLines - totalLines + 1), 8);
  return Math.round(Math.min(base, maxW / (perLine * 0.5)));
}

/* --------------------------------- scenes -------------------------------- */

function hero(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene as S<"hero">;
  const K = k(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const sid = ctx.sid;
  const p = ctx.style.palette;
  const a = ctx.assets[0];
  // Frame 0 is the cover: the opening hero is fully drawn from the first frame.
  const still = ctx.ts.start < 0.01;
  const gutter = Math.round(72 * K);
  if (s.variant === "dim") {
    const media = mediaBox(ctx, "hm", a, { x: 0, y: 0, w: W, h: H }, { focusY: s.focusY, move: "pullOut" });
    const size = fitSerif(s.headline, W - gutter * 2, 104 * K, 3);
    const html = `<div class="ed-page"></div>${media.html}<div class="vs-layer" style="background:linear-gradient(180deg,${p.bg}cc 0%,${p.bg}b3 45%,${p.bg}e6 100%);"></div>
<div class="vs-layer" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 ${gutter}px ${Math.round(H * 0.18)}px;text-align:center;gap:${Math.round(28 * K)}px;">
${splitText(`${sid}-h`, s.headline, { unit: "word", cls: "ed-serif" }).replace('class="vs-text ed-serif"', `class="vs-text ed-serif" style="font-size:${size}px;line-height:1.08;"`)}
${s.subline ? splitText(`${sid}-sub`, s.subline, { unit: "word", cls: "ed-serif ed-italic" }).replace('class="vs-text ed-serif ed-italic"', `class="vs-text ed-serif ed-italic" style="font-size:${Math.round(size * 0.92)}px;line-height:1.1;"`) : ""}
</div>`;
    let js = media.js;
    if (!still) js += textIn(`${sid}-h`, 0.15, { preset: "blur-in", stagger: 0.07, dur: 0.64 });
    if (s.subline) js += textIn(`${sid}-sub`, still ? 0.4 : 0.9, { preset: "blur-in", stagger: 0.07, dur: 0.64 });
    return { css: pageCss(ctx), html, js };
  }
  const mediaH = Math.round(H * 0.6);
  const media = mediaBox(ctx, "hm", a, { x: 0, y: 0, w: W, h: mediaH }, { focusY: s.focusY ?? 0.3 });
  const size = fitSerif(s.headline, W - gutter * 2, 128 * K, 2);
  const top = Math.round(H * 0.535);
  const html = `<div class="ed-page"></div>${media.html}
<div class="vs-layer" style="background:linear-gradient(180deg,${p.bg}99 0%,transparent 14%,transparent 34%,${p.bg} ${Math.round((mediaH / H) * 100) - 2}%,${p.bg} 100%);"></div>
<div id="${sid}-tx" style="position:absolute;left:${gutter}px;right:${gutter}px;top:${top}px;display:flex;flex-direction:column;gap:${Math.round(22 * K)}px;">
${s.eyebrow ? `<div id="${sid}-eb" class="ed-eyebrow">${e(s.eyebrow)}</div>` : ""}
${splitText(`${sid}-h`, s.headline, { unit: "word", cls: "ed-serif" }).replace('class="vs-text ed-serif"', `class="vs-text ed-serif" style="font-size:${size}px;line-height:1.04;"`)}
${s.subline ? splitText(`${sid}-sub`, s.subline, { unit: "word", cls: "ed-serif ed-italic" }).replace('class="vs-text ed-serif ed-italic"', `class="vs-text ed-serif ed-italic" style="font-size:${Math.round(size * 0.6)}px;line-height:1.1;"`) : ""}
<div id="${sid}-rule" class="ed-rule"></div>
</div>`;
  let js = media.js;
  if (!still) {
    js += `tl.fromTo("#${sid}-hm", {opacity:0}, {opacity:1, duration:0.5, ease:"${ease("entrance")}"}, 0);`;
    if (s.eyebrow) js += blockIn(`#${sid}-eb`, 0.1, "rise");
    js += textIn(`${sid}-h`, 0.2, { preset: "fade-rise", stagger: 0.06 });
  }
  if (s.subline) js += textIn(`${sid}-sub`, still ? 0.5 : 0.8, { preset: "fade-rise", stagger: 0.06 });
  js += `tl.fromTo("#${sid}-rule", {scaleX:0.2, opacity:0, transformOrigin:"0% 50%"}, {scaleX:1, opacity:1, duration:0.56, ease:"${ease("entrance")}"}, ${still ? 0.3 : 0.6});`;
  return { css: pageCss(ctx), html, js };
}

function statement(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene as S<"statement">;
  const K = k(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const sid = ctx.sid;
  const gutter = Math.round(72 * K);
  const center = s.align === "center";
  const bd = backdrop(ctx, ctx.assets[0], 0.78);
  const gl = sceneGlow(ctx, center ? 0.5 : 0.62, center ? 0.4 : 0.36, 1.1);
  const longest = Math.max(...s.lines.map((l) => l.replace(/\*/g, "").length));
  const size = Math.round(Math.min((center ? 108 : 104) * K, (W - gutter * 2) / (Math.min(longest, 20) * 0.5)));
  const lines = s.lines
    .map((l, i) => splitText(`${sid}-l${i}`, l, { unit: "word", cls: "ed-serif" }).replace('class="vs-text ed-serif"', `class="vs-text ed-serif" style="font-size:${size}px;line-height:1.08;"`))
    .join("");
  const html = `<div class="ed-page"></div>${bd.html}${gl.html}
<div style="position:absolute;left:${gutter}px;right:${gutter}px;top:${Math.round(H * (center ? 0.2 : 0.18))}px;bottom:${Math.round(H * 0.3)}px;display:flex;flex-direction:column;justify-content:center;gap:${Math.round(56 * K)}px;${center ? "text-align:center;align-items:center;" : ""}">${lines}</div>`;
  let js = bd.js + gl.js;
  if (!s.join && ctx.ts.start > 0.01) js += `tl.fromTo("#${sid}-glow", {opacity:0}, {opacity:0.55, duration:0.8, ease:"${ease("entrance")}"}, 0);`;
  let at = 0.12;
  s.lines.forEach((_, i) => {
    if (i < s.newFrom) return;
    js += textIn(`${sid}-l${i}`, at, { preset: center ? "blur-in" : "fade-rise", stagger: 0.06, dur: center ? 0.64 : 0.56 });
    at += 0.55;
  });
  return { css: pageCss(ctx), html, js };
}

function bignum(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene as S<"bignum">;
  const K = k(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const sid = ctx.sid;
  const gutter = Math.round(72 * K);
  const a = ctx.assets[0];
  const strip = a ? mediaBox(ctx, "bs", a, { x: gutter, y: H * 0.1, w: W - gutter * 2, h: H * 0.3 }, { cls: "ed-card" }) : { html: "", js: "" };
  const gl = sceneGlow(ctx, 0.3, a ? 0.53 : 0.42, 0.95);
  const numTop = Math.round(H * (a ? 0.43 : 0.3));
  const numSize = Math.round(Math.min(340 * K, (W - gutter * 2) / (Math.max(2, s.value.length) * 0.62)));
  const digits = /^\d{1,7}$/.test(s.value) ? Number(s.value) : null;
  const html = `<div class="ed-page"></div>${gl.html}${strip.html}
<div style="position:absolute;left:${gutter}px;right:${gutter}px;top:${numTop}px;display:flex;flex-direction:column;gap:${Math.round(18 * K)}px;">
<div id="${sid}-num" class="ed-serif" style="font-size:${numSize}px;line-height:.95;color:var(--vs-accent);font-variant-numeric:tabular-nums lining-nums;">${e(digits !== null ? "0" : s.value)}</div>
<div id="${sid}-lab" class="ed-serif" style="font-size:${Math.round(66 * K)}px;line-height:1.12;max-width:${Math.round(W * 0.86)}px;">${e(s.label)}</div>
${s.cite ? `<div id="${sid}-cite" class="ed-cite">${e(s.cite)}</div>` : ""}
</div>`;
  let js = strip.js + gl.js;
  if (a) js += blockIn(`#${sid}-bs`, 0.05, "scale");
  js += blockIn(`#${sid}-num`, 0.15, "rise");
  if (digits !== null) js += `tl.fromTo("#${sid}-num", {textContent:0}, {textContent:${digits}, snap:{textContent:1}, duration:1.1, ease:"${ease("entrance")}"}, 0.15);`;
  js += blockIn(`#${sid}-lab`, 0.45, "rise");
  if (s.cite) js += `tl.fromTo("#${sid}-cite", {opacity:0}, {opacity:1, duration:0.5, ease:"${ease("entrance")}"}, 0.8);`;
  return { css: pageCss(ctx), html, js };
}

/** Opacity by rank: the top of a ranking reads brightest. */
const RANK_FADE = [1, 0.86, 0.62, 0.46, 0.38];

function ranked(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene as S<"ranked">;
  const K = k(ctx);
  const W = ctx.width;
  const H = ctx.height;
  const sid = ctx.sid;
  const gutter = Math.round(72 * K);
  const a = ctx.assets[0];
  const show = Math.min(s.show ?? s.items.length, s.items.length);
  const card = a ? mediaBox(ctx, "rc", a, { x: gutter, y: H * 0.085, w: W - gutter * 2, h: H * 0.27 }, { cls: "ed-card" }) : { html: "", js: "" };
  const top = Math.round(H * (a ? 0.39 : 0.24));
  const rowH = Math.round(H * 0.085);
  const rows = s.items
    .slice(0, show)
    .map((it, i) => {
      const note = it.note ? `<span id="${sid}-n${i}" style="font:500 ${Math.round(34 * K)}px/1 '${ctx.style.fonts.ui}',sans-serif;color:var(--vs-danger);margin-left:${Math.round(18 * K)}px;white-space:nowrap;">${e(it.note)}</span>` : "";
      return `<div id="${sid}-r${i}" style="height:${rowH}px;display:flex;align-items:center;gap:${Math.round(30 * K)}px;opacity:${RANK_FADE[i] ?? 0.35};">
<span class="ed-eyebrow" style="letter-spacing:.06em;width:${Math.round(52 * K)}px;">${String(i + 1).padStart(2, "0")}</span>
<span class="ed-serif" style="font-size:${Math.round(92 * K)}px;line-height:1;white-space:nowrap;">${e(it.label)}</span>${note}</div>`;
    })
    .join("");
  const html = `<div class="ed-page"></div>${card.html}
<div style="position:absolute;left:${gutter}px;right:${gutter}px;top:${top}px;">
${s.title ? `<div id="${sid}-t" class="ed-eyebrow" style="margin-bottom:${Math.round(26 * K)}px;">${e(s.title)}</div>` : ""}
${rows}</div>`;
  let js = card.js;
  const fresh = !s.join || ctx.ts.start < 0.01;
  if (a && fresh) js += blockIn(`#${sid}-rc`, 0.05, "scale");
  if (s.title && fresh) js += `tl.fromTo("#${sid}-t", {opacity:0}, {opacity:1, duration:0.5, ease:"${ease("entrance")}"}, 0.1);`;
  let at = 0.2;
  s.items.slice(0, show).forEach((it, i) => {
    const op = RANK_FADE[i] ?? 0.35;
    if (i >= s.from) {
      js += `tl.fromTo("#${sid}-r${i}", {opacity:0, x:${Math.round(-24 * K)}}, {opacity:${op}, x:0, duration:0.56, ease:"${ease("entrance")}"}, ${n(at)});`;
      at += 0.07;
    }
    if (it.note && i >= s.from) js += `tl.fromTo("#${sid}-n${i}", {opacity:0}, {opacity:1, duration:0.4, ease:"${ease("entrance")}"}, ${n(at + 0.35)});`;
    else if (it.note && i < s.from) js += `tl.fromTo("#${sid}-n${i}", {opacity:0, y:${Math.round(10 * K)}}, {opacity:1, y:0, duration:0.45, ease:"${ease("entrance")}"}, 0.15);`;
  });
  return { css: pageCss(ctx), html, js };
}

function checklist(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene as S<"checklist">;
  const K = k(ctx);
  const H = ctx.height;
  const W = ctx.width;
  const sid = ctx.sid;
  const p = ctx.style.palette;
  const gutter = Math.round(72 * K);
  const show = Math.min(s.show ?? s.items.length, s.items.length);
  const bd = backdrop(ctx, ctx.assets[0], 0.82);
  const okIdx = s.items.findIndex((it) => it.ok);
  const gl = okIdx >= 0 && okIdx < show ? sceneGlow(ctx, 0.3, 0.26 + okIdx * 0.09, 0.8) : { html: "", js: "" };
  const mark = Math.round(108 * K);
  const rows = s.items
    .slice(0, show)
    .map(
      (it, i) => `<div id="${sid}-r${i}" style="display:flex;align-items:center;gap:${Math.round(34 * K)}px;height:${Math.round(H * 0.105)}px;${it.ok ? "" : "opacity:.6;"}">
${brushMark(`${sid}-m${i}`, it.ok, it.ok ? p.accent : p.danger, mark)}
<span class="ed-serif" style="font-size:${Math.round((it.ok ? 116 : 96) * K)}px;line-height:1;${it.ok ? "color:var(--vs-accent);" : ""}white-space:nowrap;">${e(it.label)}</span></div>`,
    )
    .join("");
  const html = `<div class="ed-page"></div>${bd.html}${gl.html}<div style="position:absolute;left:${gutter}px;right:${gutter}px;top:${Math.round(H * 0.22)}px;max-width:${W - gutter * 2}px;">${rows}</div>`;
  let js = bd.js + gl.js;
  let at = 0.15;
  s.items.slice(0, show).forEach((it, i) => {
    if (i < s.from) return;
    js += `tl.fromTo("#${sid}-r${i}", {opacity:0, y:${Math.round(18 * K)}}, {opacity:${it.ok ? 1 : 0.6}, y:0, duration:0.5, ease:"${ease("entrance")}"}, ${n(at)});`;
    js += brushDraw(`${sid}-m${i}`, it.ok, at + 0.12);
    at += 0.5;
  });
  return { css: pageCss(ctx), html, js };
}

registerRenderer("hero", hero);
registerRenderer("statement", statement);
registerRenderer("bignum", bignum);
registerRenderer("ranked", ranked);
registerRenderer("checklist", checklist);

/** Scene types whose layout holds (text to read), so long shots are expected. */
export const EDITORIAL_SCENES = ["hero", "statement", "bignum", "ranked", "checklist"] as const;
