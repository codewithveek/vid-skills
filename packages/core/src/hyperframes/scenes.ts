/**
 * Scene renderers: each turns one TimedScene into HyperFrames markup + a paused
 * GSAP timeline. Rules honoured (from the HyperFrames contract):
 *  - everything visible is a function of timeline time (no Date/Math.random/timers, finite repeats)
 *  - fromTo (not from) so seeking backwards never drifts
 *  - GSAP never animates a `.clip` itself, only children; no CSS transform on tweened nodes
 *  - ids are prefixed with the scene id so they stay unique in the assembled page
 */
import type { Asset, TimedScene } from "../spec.js";
import type { StylePack } from "../styles/types.js";
import { escapeHtml as e, hashString, round3, seededRandom } from "../util.js";
import { iconSvg } from "./icons.js";

export interface SceneAsset {
  path: string;
  asset: Asset;
}

export interface SceneCtx {
  sid: string;
  ts: TimedScene;
  style: StylePack;
  width: number;
  height: number;
  blurFill: boolean;
  /** Media window size (defaults to the canvas) */
  win?: { w: number; h: number };
  assets: SceneAsset[];
  fps: number;
  /** Registers a derived asset (e.g. a pre-blurred background) and returns its project path. */
  derive: (from: SceneAsset, op: "blur-bg") => string | null;
}

export interface SceneOutput {
  css: string;
  html: string;
  /** body of the timeline builder; `tl` is in scope */
  js: string;
}

const n = (v: number) => round3(v);

/* ----------------------------- media helpers ---------------------- */

function mediaTag(id: string, a: SceneAsset | undefined, dur: number, cls = "vs-media", mediaStart = 0): string {
  if (!a) return `<div id="${id}" class="${cls} vs-missing"></div>`;
  if (a.asset.kind === "video") {
    const ms = mediaStart ? ` data-media-start="${n(mediaStart)}"` : "";
    return `<video id="${id}" class="clip ${cls}" src="${e(a.path)}" muted playsinline data-start="0" data-duration="${n(dur)}"${ms}></video>`;
  }
  return `<img id="${id}" class="${cls}" src="${e(a.path)}" alt="" />`;
}

/** A full-canvas layer: blurred fill behind + the content window holding the media. */
function mediaLayer(ctx: SceneCtx, key: string, a: SceneAsset | undefined, dur: number, opts: { treatment?: string; tag?: string } = {}): string {
  const id = `${ctx.sid}-${key}`;
  const t = opts.treatment && opts.treatment !== "natural" ? ` vs-t-${opts.treatment}` : "";
  let bg = "";
  if (ctx.blurFill) {
    // The fill is a separate, pre-blurred low-res derivative (made by the renderer with ffmpeg):
    // no duplicate media nodes, no per-frame CSS blur, and no CSS filters on footage.
    const derived = a ? ctx.derive(a, "blur-bg") : null;
    const inner = derived && a ? mediaTag(`${id}-bgm`, { path: derived, asset: a.asset }, dur, "vs-media") : "";
    bg = `<div class="vs-fill">${inner ? `<div class="vs-blur">${inner}</div>` : `<div class="vs-stage"></div>`}<div class="vs-dim"></div></div>`;
  }
  const tag = opts.tag ? `<div class="vs-tagwrap"><span id="${id}-tag" class="vs-tag">${e(opts.tag)}</span></div>` : "";
  return `${bg}<div class="vs-window"><div id="${id}-mw" class="vs-mw${t}" data-layout-allow-overflow>${mediaTag(`${id}-m`, a, dur)}</div>${tag}</div>`;
}

function moveTween(sel: string, move: string, dur: number, seed: number): string {
  const r = seededRandom(seed);
  const dir = r() > 0.5 ? 1 : -1;
  switch (move) {
    case "static":
      return "";
    case "pullOut":
      return `tl.fromTo("${sel}", {scale:1.1}, {scale:1.0, duration:${n(dur)}, ease:"none"}, 0);`;
    case "panLeft":
      return `tl.fromTo("${sel}", {scale:1.12, xPercent:3}, {scale:1.12, xPercent:-3, duration:${n(dur)}, ease:"none"}, 0);`;
    case "panRight":
      return `tl.fromTo("${sel}", {scale:1.12, xPercent:-3}, {scale:1.12, xPercent:3, duration:${n(dur)}, ease:"none"}, 0);`;
    case "kenBurns":
      return `tl.fromTo("${sel}", {scale:1.04, xPercent:${-2 * dir}, yPercent:-1}, {scale:1.14, xPercent:${2 * dir}, yPercent:1, duration:${n(dur)}, ease:"none"}, 0);`;
    case "pushIn":
    default:
      return `tl.fromTo("${sel}", {scale:1.0}, {scale:1.07, duration:${n(dur)}, ease:"none"}, 0);`;
  }
}

function tagPop(ctx: SceneCtx, key: string, at = 0.12): string {
  return `tl.fromTo("#${ctx.sid}-${key}-tag", {scale:0.6, opacity:0}, {scale:1, opacity:1, duration:0.18, ease:"back.out(2)"}, ${at});`;
}

function darkStage(ctx: SceneCtx, inner: string): string {
  return `<div class="vs-stage"></div><div class="vs-window vs-window-dark"><div id="${ctx.sid}-inner" class="vs-center">${inner}</div></div>`;
}

/* ----------------------------- scene types ------------------------ */

function broll(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "broll") throw new Error("broll");
  const d = ctx.ts.duration;
  const html = mediaLayer(ctx, "a", ctx.assets[0], d, { treatment: s.treatment, tag: s.label });
  const js = moveTween(`#${ctx.sid}-a-mw`, s.move, d, hashString(ctx.sid)) + (s.label ? tagPop(ctx, "a") : "");
  return { css: "", html, js };
}

function montage(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "montage") throw new Error("montage");
  const d = ctx.ts.duration;
  const per = s.perItemSec;
  const count = Math.max(1, Math.min(s.items.length, ctx.assets.length || s.items.length));
  const times = s.itemTimes && s.itemTimes.length >= count ? s.itemTimes : Array.from({ length: count }, (_, i) => i * per);
  let html = "";
  for (let i = 0; i < count; i++) {
    const start = n(times[i]!);
    const len = i === count - 1 ? n(Math.max(0.05, d - start)) : n(Math.max(0.05, times[i + 1]! - times[i]!));
    html += `<div id="${ctx.sid}-i${i}" class="clip vs-layer" data-start="${start}" data-duration="${len}">${mediaLayer(ctx, `i${i}x`, ctx.assets[i], len)}</div>`;
  }
  // Hard cuts, no tweens: the reference cuts enumerations at 6-8 frames per item.
  return { css: "", html, js: "" };
}

function diagram(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "diagram") throw new Error("diagram");
  const p = ctx.style.palette;
  const d = ctx.ts.duration;
  const sid = ctx.sid;
  const data = s.data as Record<string, unknown>;
  const draw = ctx.style.motion.drawOnSec;
  const str = (k: string, def = "") => (typeof data[k] === "string" ? (data[k] as string) : def);
  const arr = <T,>(k: string): T[] => (Array.isArray(data[k]) ? (data[k] as T[]) : []);
  const drawOn = (sel: string, at: number, dur = draw) =>
    `tl.fromTo("${sel} path", {strokeDashoffset:1}, {strokeDashoffset:0, duration:${n(dur)}, ease:"power2.out", stagger:0.08}, ${n(at)});`;

  switch (s.template) {
    case "icon-draw": {
      const icon = str("icon", "power");
      const color = str("color", p.on);
      const label = str("label");
      const html = darkStage(
        ctx,
        `<div id="${sid}-btn" class="vs-roundbtn">${iconSvg(icon, `${sid}-ic`, { size: 150, color, stroke: 1.6, glow: str("glow") ? color : undefined })}</div>${label ? `<div id="${sid}-lb" class="vs-smallcaps">${e(label)}</div>` : ""}`,
      );
      let js = `tl.fromTo("#${sid}-btn", {scale:0.92, opacity:0}, {scale:1, opacity:1, duration:0.25, ease:"power2.out"}, 0);` + drawOn(`#${sid}-ic`, 0.15);
      if (label) js += `tl.fromTo("#${sid}-lb", {opacity:0, y:10}, {opacity:1, y:0, duration:0.3}, ${n(0.2 + draw)});`;
      return { css: "", html, js };
    }
    case "button-cards": {
      type Card = { icon?: string; label?: string; state?: string };
      const cards = arr<Card>("cards").slice(0, 4);
      if (!cards.length) cards.push({ icon: "power", label: "POWER" });
      const active = typeof data.active === "number" ? (data.active as number) : -1;
      const colorOf = (st?: string) => (st === "on" ? p.on : st === "standby" ? p.standby : st === "danger" ? p.danger : st === "sleep" ? "#8B7CF6" : p.ink);
      const html = darkStage(
        ctx,
        `<div class="vs-cards">${cards
          .map(
            (c, i) =>
              `<div id="${sid}-c${i}" class="vs-card"><div class="vs-roundbtn vs-roundbtn-sm">${iconSvg(c.icon ?? "power", `${sid}-c${i}i`, { size: 96, color: colorOf(c.state), stroke: 1.7 })}</div><div class="vs-smallcaps">${e(c.label ?? "")}</div></div>`,
          )
          .join("")}</div>`,
      );
      let js = "";
      cards.forEach((_, i) => {
        const at = 0.12 * i;
        js += `tl.fromTo("#${sid}-c${i}", {y:24, opacity:0}, {y:0, opacity:1, duration:0.32, ease:"power3.out"}, ${n(at)});`;
        js += drawOn(`#${sid}-c${i}i`, at + 0.1);
      });
      if (active >= 0 && active < cards.length) {
        js += `tl.fromTo("#${sid}-c${active}i", {filter:"drop-shadow(0 0 0px ${p.on})"}, {filter:"drop-shadow(0 0 14px ${p.on})", duration:0.4}, ${n(Math.min(d * 0.5, 0.9))});`;
        js += `tl.fromTo("#${sid}-c${active}", {scale:1}, {scale:1.06, duration:0.12, yoyo:true, repeat:1}, ${n(Math.min(d * 0.5, 0.9))});`;
      }
      return { css: "", html, js };
    }
    case "toggle-switch": {
      const onLabel = str("onLabel", "I");
      const offLabel = str("offLabel", "O");
      const html = darkStage(
        ctx,
        `<div class="vs-rocker"><div id="${sid}-knob" class="vs-rocker-knob"><span class="vs-rk-on">${e(onLabel)}</span><span class="vs-rk-off">${e(offLabel)}</span></div></div>${str("label") ? `<div class="vs-smallcaps">${e(str("label"))}</div>` : ""}`,
      );
      const flipAt = n(Math.min(0.9, d * 0.5));
      const js = `tl.fromTo("#${sid}-knob", {rotationX:18, transformPerspective:600}, {rotationX:-18, transformPerspective:600, duration:0.12, ease:"power4.in"}, ${flipAt});tl.fromTo("#${sid}-knob .vs-rk-on", {color:"${p.on}", textShadow:"0 0 18px ${p.on}"}, {color:"${p.muted}", textShadow:"0 0 0px ${p.on}", duration:0.1}, ${flipAt});`;
      return { css: "", html, js };
    }
    case "flow": {
      type Node = { label?: string; icon?: string };
      const nodes = arr<Node>("nodes").slice(0, 4);
      if (nodes.length < 2) nodes.push({ label: "A", icon: "plug" }, { label: "B", icon: "cpu" });
      const html = darkStage(
        ctx,
        `<div class="vs-flow">${nodes
          .map(
            (nd, i) =>
              `${i ? `<div class="vs-flow-line"><div id="${sid}-l${i}" class="vs-flow-fill"></div></div>` : ""}<div id="${sid}-n${i}" class="vs-flow-node">${iconSvg(nd.icon ?? "cpu", `${sid}-n${i}i`, { size: 64, color: p.ink, stroke: 1.7 })}<div class="vs-smallcaps vs-tiny">${e(nd.label ?? "")}</div></div>`,
          )
          .join("")}</div>`,
      );
      let js = "";
      const step = Math.max(0.25, Math.min(0.6, (d - 0.4) / nodes.length));
      nodes.forEach((_, i) => {
        const at = i * step;
        js += `tl.fromTo("#${sid}-n${i}", {scale:0.8, opacity:0}, {scale:1, opacity:1, duration:0.22, ease:"back.out(1.8)"}, ${n(at)});`;
        if (i) js += `tl.fromTo("#${sid}-l${i}", {scaleX:0}, {scaleX:1, duration:${n(step * 0.8)}, ease:"none"}, ${n(at - step * 0.8)});`;
      });
      return { css: "", html, js };
    }
    case "compare": {
      const left = str("left", "THE OLD WAY");
      const right = str("right", "THE NEW WAY");
      const li = str("leftIcon", "onoff");
      const ri = str("rightIcon", "power");
      const html = darkStage(
        ctx,
        `<div class="vs-cards"><div id="${sid}-L" class="vs-card">${iconSvg(li, `${sid}-Li`, { size: 110, color: p.ink })}<div class="vs-smallcaps">${e(left)}</div></div><div class="vs-vs">VS</div><div id="${sid}-R" class="vs-card vs-card-hot">${iconSvg(ri, `${sid}-Ri`, { size: 110, color: p.standby })}<div class="vs-smallcaps">${e(right)}</div></div></div>`,
      );
      const js =
        `tl.fromTo("#${sid}-L", {x:-40, opacity:0}, {x:0, opacity:1, duration:0.3, ease:"power3.out"}, 0);` +
        drawOn(`#${sid}-Li`, 0.1) +
        `tl.fromTo("#${sid}-R", {x:40, opacity:0}, {x:0, opacity:1, duration:0.25, ease:"power3.out"}, ${n(Math.min(0.35, d * 0.15))});` +
        drawOn(`#${sid}-Ri`, Math.min(0.45, d * 0.2));
      return { css: "", html, js };
    }
    case "counter": {
      const from = Number(data.from ?? 0);
      const to = Number(data.to ?? 100);
      const unit = str("unit");
      const label = str("label");
      const html = darkStage(ctx, `<div id="${sid}-num" class="vs-counter" style="--vs-n:${from}"></div>${unit ? `<span class="vs-unit">${e(unit)}</span>` : ""}${label ? `<div class="vs-smallcaps">${e(label)}</div>` : ""}`);
      const css = `#${sid}-num{counter-reset:vsn var(--vs-n);} #${sid}-num::after{content:counter(vsn);}`;
      const js = `tl.fromTo("#${sid}-num", {"--vs-n":${from}}, {"--vs-n":${to}, duration:${n(Math.min(1.4, d * 0.7))}, ease:"power2.out", snap:{"--vs-n":1}}, 0.1);`;
      return { css, html, js };
    }
    case "timeline": {
      type Ev = { year?: string; label?: string };
      const evs = arr<Ev>("events").slice(0, 5);
      if (!evs.length) evs.push({ year: "1973", label: "IEC 417" }, { year: "2004", label: "IEEE 1621" });
      const html = darkStage(
        ctx,
        `<div class="vs-tl"><div class="vs-tl-rail"><div id="${sid}-rail" class="vs-tl-fill"></div></div>${evs
          .map((ev, i) => `<div id="${sid}-e${i}" class="vs-tl-ev" style="left:${n((i / Math.max(1, evs.length - 1)) * 100)}%"><div class="vs-tl-dot"></div><div class="vs-tl-year">${e(ev.year ?? "")}</div><div class="vs-tl-label">${e(ev.label ?? "")}</div></div>`)
          .join("")}</div>`,
      );
      const span = Math.max(0.3, Math.min(d * 0.6, d - 0.9)); // last event must stay readable (≥ 0.8 s)
      let js = `tl.fromTo("#${sid}-rail", {scaleX:0}, {scaleX:1, duration:${n(span)}, ease:"none"}, 0.1);`;
      evs.forEach((_, i) => {
        js += `tl.fromTo("#${sid}-e${i}", {opacity:0, y:14}, {opacity:1, y:0, duration:0.25}, ${n(0.1 + (span * i) / Math.max(1, evs.length - 1))});`;
      });
      return { css: "", html, js };
    }
    case "checklist":
    default: {
      const items = arr<string>("items").slice(0, 6);
      if (!items.length) items.push(String(data.text ?? "…"));
      const html = darkStage(
        ctx,
        `<div class="vs-list">${items.map((it, i) => `<div id="${sid}-li${i}" class="vs-li">${iconSvg("check", `${sid}-li${i}c`, { size: 44, color: p.on, stroke: 2.4 })}<span>${e(String(it))}</span></div>`).join("")}</div>`,
      );
      let js = "";
      const step = Math.max(0.25, Math.min(0.8, (d - 0.3) / items.length));
      items.forEach((_, i) => {
        js += `tl.fromTo("#${sid}-li${i}", {opacity:0, x:-20}, {opacity:1, x:0, duration:0.22}, ${n(i * step)});` + drawOn(`#${sid}-li${i}c`, i * step + 0.1, 0.3);
      });
      return { css: "", html, js };
    }
  }
}

function typewriter(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "typewriter") throw new Error("typewriter");
  const sid = ctx.sid;
  const chars = [...`${s.lead} `].map((c) => ({ c, hi: false })).concat([...s.highlight].map((c) => ({ c, hi: true })));
  // Type faster when the shot is short, so the line is complete for ≥ 40 % of the shot (never < 1/40 s a char).
  const per = Math.max(1 / 40, Math.min(1 / s.cps, (ctx.ts.duration * 0.6 - 0.1) / chars.length));
  // Fit the typed line inside the window: Inter 800 averages ~0.58 em per glyph.
  const k = ctx.width / 1080;
  const winW = ctx.win?.w ?? ctx.width;
  const size = Math.max(Math.round(40 * k), Math.min(Math.round(92 * k), Math.floor((winW * 0.88) / (chars.length * 0.58))));
  const html = darkStage(
    ctx,
    `<div class="vs-type" style="font-size:${size}px">${chars.map((ch, i) => `<span id="${sid}-ch${i}" class="${ch.hi ? "vs-type-hi" : "vs-type-lead"}">${ch.c === " " ? "&nbsp;" : e(ch.c)}</span>`).join("")}<span id="${sid}-caret" class="vs-caret"></span></div>`,
  );
  let js = "";
  chars.forEach((_, i) => {
    // display (not opacity) so the caret follows the typed text; these spans are not .clip elements.
    js += `tl.fromTo("#${sid}-ch${i}", {display:"none"}, {display:"inline", duration:0.001}, ${n(0.1 + i * per)});`;
  });
  const typedEnd = 0.1 + chars.length * per;
  const blinks = Math.max(1, Math.floor((ctx.ts.duration - typedEnd) / 0.5));
  js += `tl.fromTo("#${sid}-caret", {opacity:1}, {opacity:0, duration:0.25, ease:"steps(1)", yoyo:true, repeat:${blinks * 2 - 1}}, ${n(typedEnd)});`;
  return { css: "", html, js };
}

function documentScene(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "document") throw new Error("document");
  const sid = ctx.sid;
  const d = ctx.ts.duration;
  const a = ctx.assets[0];
  const img = a ? `<img id="${sid}-img" class="vs-doc-img" src="${e(a.path)}" alt="" />` : `<div class="vs-doc-img vs-missing"></div>`;
  const hl = s.highlights
    .map((h, i) => `<div id="${sid}-h${i}" class="vs-hl" style="left:${n(h.x * 100)}%;top:${n(h.y * 100)}%;width:${n(h.w * 100)}%;height:${n(h.h * 100)}%"></div>`)
    .join("");
  const html = `<div class="vs-stage vs-stage-light"></div><div class="vs-window vs-window-light"><div id="${sid}-zoom" class="vs-doc-zoom"><div id="${sid}-page" class="vs-doc-page">${img}${hl}</div></div></div>`;
  let js = "";
  let t = 0;
  if (s.pageTurn) {
    js += `tl.fromTo("#${sid}-page", {rotationY:-70, xPercent:-35, opacity:0, transformPerspective:1400, transformOrigin:"0% 50%"}, {rotationY:0, xPercent:0, opacity:1, transformPerspective:1400, transformOrigin:"0% 50%", duration:0.5, ease:"power3.out"}, 0);`;
    t = 0.55;
  }
  if (s.zoomTo) {
    const z = s.zoomTo;
    js += `tl.fromTo("#${sid}-zoom", {scale:1, xPercent:0, yPercent:0}, {scale:${z.scale}, xPercent:${n((0.5 - z.x) * 100)}, yPercent:${n((0.5 - z.y) * 100)}, duration:0.6, ease:"power2.inOut"}, ${n(t)});`;
    t += 0.65;
  }
  s.highlights.forEach((_, i) => {
    js += `tl.fromTo("#${sid}-h${i}", {scaleX:0}, {scaleX:1, duration:0.45, ease:"power1.inOut", transformOrigin:"0% 50%"}, ${n(Math.min(d - 0.5, t + i * 0.55))});`;
  });
  return { css: "", html, js };
}

function analogy(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "analogy") throw new Error("analogy");
  const d = ctx.ts.duration;
  const html = mediaLayer(ctx, "a", ctx.assets[0], d, { tag: s.caption });
  const js = `tl.fromTo("#${ctx.sid}-a-mw", {scale:1.0}, {scale:1.04, duration:${n(d)}, ease:"none"}, 0);` + tagPop(ctx, "a", 0.1);
  return { css: "", html, js };
}

function stat(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "stat") throw new Error("stat");
  const sid = ctx.sid;
  const html = darkStage(ctx, `<div id="${sid}-v" class="vs-stat">${e(s.value)}</div><div id="${sid}-c" class="vs-stat-cap">${e(s.caption)}</div>`);
  const js = `tl.fromTo("#${sid}-v", {scale:0.6, opacity:0}, {scale:1, opacity:1, duration:0.3, ease:"back.out(2)"}, 0.05);tl.fromTo("#${sid}-c", {opacity:0, y:12}, {opacity:1, y:0, duration:0.3}, 0.3);`;
  return { css: "", html, js };
}

function quote(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "quote") throw new Error("quote");
  const sid = ctx.sid;
  // Don't double up: text that already opens with a quotation mark keeps its own.
  const text = /^["“'‘]/.test(s.text.trim()) ? e(s.text) : `“${e(s.text)}”`;
  const html = darkStage(ctx, `<div id="${sid}-q" class="vs-quote">${text}</div>${s.attribution ? `<div id="${sid}-a" class="vs-quote-by">— ${e(s.attribution)}</div>` : ""}`);
  const js = `tl.fromTo("#${sid}-q", {opacity:0, y:16}, {opacity:1, y:0, duration:0.35, ease:"power2.out"}, 0.05);` + (s.attribution ? `tl.fromTo("#${sid}-a", {opacity:0}, {opacity:1, duration:0.3}, 0.4);` : "");
  return { css: "", html, js };
}

function cta(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "cta") throw new Error("cta");
  const sid = ctx.sid;
  const p = ctx.style.palette;
  const d = ctx.ts.duration;
  const click = n(Math.min(1.0, d * 0.45));
  const html = darkStage(
    ctx,
    `<div class="vs-cta-wrap"><div id="${sid}-pill" class="vs-pill"><div id="${sid}-ico" class="vs-pill-ico">${iconSvg("power", `${sid}-pi`, { size: 74, color: p.danger, stroke: 2 })}</div><span id="${sid}-t1" class="vs-pill-t">${e(s.text)}</span><span id="${sid}-t2" class="vs-pill-t vs-pill-done">✓ ${e(s.doneText)}</span></div><svg id="${sid}-cur" class="vs-cursor" width="56" height="56" viewBox="0 0 24 24"><path d="M5 3l14 8-6 1.5L10 19z" fill="#fff" stroke="#000" stroke-width="1"/></svg></div><div id="${sid}-leak" class="vs-leak"></div>`,
  );
  const js = [
    `tl.fromTo("#${sid}-pill", {width:150, backgroundColor:"${p.card}"}, {width:560, backgroundColor:"${p.danger}", duration:0.33, ease:"power3.inOut"}, 0.0);`,
    `tl.fromTo("#${sid}-ico", {opacity:1, scale:1}, {opacity:0, scale:0.5, duration:0.2}, 0.05);`,
    `tl.fromTo("#${sid}-t1", {opacity:0, y:8}, {opacity:1, y:0, duration:0.2}, 0.3);`,
    `tl.fromTo("#${sid}-cur", {x:260, y:260, opacity:0}, {x:40, y:40, opacity:1, duration:0.5, ease:"power2.out"}, ${n(click - 0.5)});`,
    `tl.fromTo("#${sid}-pill", {scale:1}, {scale:0.93, duration:0.07, yoyo:true, repeat:1}, ${click});`,
    `tl.fromTo("#${sid}-pill", {backgroundColor:"${p.danger}"}, {backgroundColor:"#2A2B31", duration:0.15}, ${n(click + 0.1)});`,
    `tl.fromTo("#${sid}-t1", {opacity:1}, {opacity:0, duration:0.1}, ${n(click + 0.1)});`,
    `tl.fromTo("#${sid}-t2", {opacity:0}, {opacity:1, duration:0.15}, ${n(click + 0.15)});`,
    `tl.fromTo("#${sid}-leak", {opacity:0}, {opacity:0.95, duration:${n(Math.min(0.2, d * 0.1))}, yoyo:true, repeat:1, ease:"power1.inOut"}, ${n(Math.max(click + 0.4, d - 0.4))});`,
  ].join("");
  return { css: "", html, js };
}

function endcard(ctx: SceneCtx): SceneOutput {
  const s = ctx.ts.scene;
  if (s.type !== "endcard") throw new Error("endcard");
  const sid = ctx.sid;
  const html = `<div class="vs-stage"></div><div class="vs-endcard">${s.text ? `<div id="${sid}-tx" class="vs-end-text">${e(s.text)}</div>` : ""}${s.handle ? `<div id="${sid}-search" class="vs-search"><span class="vs-search-ico">⌕</span><span>${e(s.handle)}</span></div>` : ""}</div>`;
  const js = `${s.text ? `tl.fromTo("#${sid}-tx", {opacity:0, y:14}, {opacity:1, y:0, duration:0.3}, 0.05);` : ""}${s.handle ? `tl.fromTo("#${sid}-search", {scaleX:0.4, opacity:0}, {scaleX:1, opacity:1, duration:0.35, ease:"power3.out"}, 0.15);` : ""}`;
  return { css: "", html, js };
}

const RENDERERS: Record<string, (ctx: SceneCtx) => SceneOutput> = {
  broll,
  montage,
  diagram,
  typewriter,
  document: documentScene,
  analogy,
  stat,
  quote,
  cta,
  endcard,
};

export function renderScene(ctx: SceneCtx): SceneOutput {
  const r = RENDERERS[ctx.ts.scene.type];
  if (!r) throw new Error(`no renderer for scene type ${ctx.ts.scene.type}`);
  const out = r(ctx);
  return { ...out, js: stabilizeFromTo(out.js) };
}

/**
 * GSAP applies a fromTo's "from" values at authoring time. When several fromTo
 * tweens target the same element, every one except the earliest-positioned must
 * carry `immediateRender:false`, or seeking before the first tween shows the
 * last-authored start state (HyperFrames lint: gsap_repeated_fromto_without_baseline).
 */
export function stabilizeFromTo(js: string): string {
  type Call = { start: number; toBrace: number; sel: string; pos: number };
  const calls: Call[] = [];
  const re = /tl\.fromTo\("([^"]+)",\s*/g;
  for (let m = re.exec(js); m; m = re.exec(js)) {
    const fromStart = m.index + m[0].length;
    const fromEnd = matchBrace(js, fromStart);
    if (fromEnd < 0) continue;
    const toStart = js.indexOf("{", fromEnd + 1);
    const toEnd = matchBrace(js, toStart);
    if (toStart < 0 || toEnd < 0) continue;
    const posM = /^\s*,\s*([0-9.]+)/.exec(js.slice(toEnd + 1));
    calls.push({ start: m.index, toBrace: toStart, sel: m[1]!, pos: posM ? Number(posM[1]) : 0 });
  }
  const bySel = new Map<string, Call[]>();
  for (const c of calls) bySel.set(c.sel, [...(bySel.get(c.sel) ?? []), c]);
  const inserts: number[] = [];
  for (const list of bySel.values()) {
    if (list.length < 2) continue;
    const first = list.reduce((a, b) => (b.pos < a.pos ? b : a));
    for (const c of list) if (c !== first && !js.slice(c.toBrace, matchBrace(js, c.toBrace)).includes("immediateRender")) inserts.push(c.toBrace + 1);
  }
  inserts.sort((a, b) => b - a);
  let out = js;
  for (const at of inserts) out = `${out.slice(0, at)}immediateRender:false, ${out.slice(at)}`;
  return out;
}

function matchBrace(s: string, open: number): number {
  if (s[open] !== "{") return -1;
  let depth = 0;
  let q: string | null = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === "\\") i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Shared CSS for every scene, emitted once in index.html. */
export function sharedCss(style: StylePack, win: { x: number; y: number; w: number; h: number }, width: number, height: number): string {
  const p = style.palette;
  const f = style.fonts;
  const k = width / 1080; // scale factor vs. the 1080-wide reference
  return `
:root{--vs-bg:${p.bg};--vs-card:${p.card};--vs-ink:${p.ink};--vs-muted:${p.muted};--vs-title:${p.title};--vs-title-stroke:${p.titleStroke};--vs-accent:${p.accent};--vs-on:${p.on};--vs-standby:${p.standby};--vs-danger:${p.danger};--vs-hl:${p.highlight};--vs-tag-bg:${p.tagBg};--vs-tag-ink:${p.tagInk};--win-x:${win.x}px;--win-y:${win.y}px;--win-w:${win.w}px;--win-h:${win.h}px;--k:${k};}
@property --vs-n{syntax:'<integer>';inherits:false;initial-value:0;}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:var(--vs-bg);}
body{font-family:"${f.ui}",sans-serif;color:var(--vs-ink);}
.vs-layer{position:absolute;inset:0;}
.vs-fill{position:absolute;inset:0;overflow:hidden;background:#000;}
.vs-blur{position:absolute;inset:0;}
.vs-dim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.15) 40%,rgba(0,0,0,.45));}
.vs-window{position:absolute;left:var(--win-x);top:var(--win-y);width:var(--win-w);height:var(--win-h);overflow:hidden;background:#000;}
.vs-window-dark{background:transparent;}
.vs-window-light{background:#f4f4f2;}
.vs-mw{position:absolute;inset:0;}
.vs-media{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;}
.vs-missing{background:repeating-linear-gradient(45deg,#1b1c22 0 20px,#22232a 20px 40px);}
.vs-t-bw{filter:grayscale(1) contrast(1.12);}
.vs-t-dark{filter:brightness(.7) contrast(1.05);}
.vs-t-warm{filter:sepia(.25) saturate(1.1);}
.vs-t-cool{filter:hue-rotate(-8deg) saturate(.9) brightness(.95);}
.vs-t-vintage{filter:sepia(.45) contrast(1.1) brightness(.92);}
.vs-tagwrap{position:absolute;left:0;right:0;bottom:9%;display:flex;justify-content:center;}
.vs-tag{display:inline-block;background:var(--vs-tag-bg);color:var(--vs-tag-ink);font:600 ${Math.round(36 * k)}px/1.1 "${f.ui}",sans-serif;padding:${Math.round(8 * k)}px ${Math.round(16 * k)}px;border-radius:${Math.round(10 * k)}px;box-shadow:0 4px 18px rgba(0,0,0,.35);}
.vs-stage{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,#1a1b22 0%,var(--vs-bg) 62%);}
.vs-stage-light{background:radial-gradient(ellipse at 50% 40%,#f7f7f9 0%,#dcdde3 100%);}
.vs-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(22 * k)}px;}
.vs-roundbtn{width:${Math.round(230 * k)}px;height:${Math.round(230 * k)}px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#23242c,#121318 70%);box-shadow:0 18px 40px rgba(0,0,0,.55),inset 0 2px 2px rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;}
.vs-roundbtn-sm{width:${Math.round(150 * k)}px;height:${Math.round(150 * k)}px;}
.vs-smallcaps{font:700 ${Math.round(32 * k)}px/1 "${f.ui}",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#b9bcc6;}
.vs-tiny{font-size:${Math.round(28 * k)}px;}
.vs-cards{display:flex;gap:${Math.round(34 * k)}px;align-items:center;}
.vs-card{width:${Math.round(260 * k)}px;height:${Math.round(330 * k)}px;border-radius:${Math.round(22 * k)}px;background:linear-gradient(180deg,#1b1c22,#131419);box-shadow:0 22px 50px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.04);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(30 * k)}px;}
.vs-card-hot{box-shadow:0 22px 50px rgba(0,0,0,.6),0 0 0 2px rgba(255,159,28,.35);}
.vs-vs{font:900 ${Math.round(40 * k)}px "${f.ui}",sans-serif;color:color-mix(in srgb,var(--vs-ink) 55%,var(--vs-bg));}
.vs-rocker{width:${Math.round(170 * k)}px;height:${Math.round(300 * k)}px;border-radius:${Math.round(18 * k)}px;background:#0d0e12;box-shadow:inset 0 0 0 3px #22232a,0 20px 40px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;}
.vs-rocker-knob{width:76%;height:86%;border-radius:${Math.round(12 * k)}px;background:linear-gradient(180deg,#24252c,#15161b);display:flex;flex-direction:column;align-items:center;justify-content:space-around;font:700 ${Math.round(64 * k)}px "${f.ui}",sans-serif;}
.vs-rk-on{color:var(--vs-on);}
.vs-rk-off{color:var(--vs-muted);}
.vs-flow{display:flex;align-items:center;gap:0;}
.vs-flow-node{width:${Math.round(170 * k)}px;height:${Math.round(170 * k)}px;border-radius:${Math.round(20 * k)}px;background:#17181e;box-shadow:0 14px 34px rgba(0,0,0,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(10 * k)}px;}
.vs-flow-line{width:${Math.round(110 * k)}px;height:4px;background:#2a2b33;}
.vs-flow-fill{width:100%;height:100%;background:repeating-linear-gradient(90deg,var(--vs-standby) 0 10px,transparent 10px 18px);transform-origin:0 50%;}
.vs-counter{font:900 ${Math.round(190 * k)}px/1 "${f.ui}",sans-serif;color:var(--vs-accent);font-variant-numeric:tabular-nums;}
.vs-unit{font:800 ${Math.round(60 * k)}px "${f.ui}",sans-serif;color:var(--vs-accent);}
.vs-tl{position:relative;width:70%;height:${Math.round(240 * k)}px;}
.vs-tl-rail{position:absolute;left:0;right:0;top:50%;height:4px;background:#2a2b33;}
.vs-tl-fill{width:100%;height:100%;background:var(--vs-accent);transform-origin:0 50%;}
.vs-tl-ev{position:absolute;top:50%;width:0;display:flex;flex-direction:column;align-items:center;}
.vs-tl-dot{width:${Math.round(22 * k)}px;height:${Math.round(22 * k)}px;border-radius:50%;background:var(--vs-accent);margin-top:-${Math.round(11 * k)}px;box-shadow:0 0 16px var(--vs-accent);}
.vs-tl-year{margin-top:${Math.round(18 * k)}px;font:800 ${Math.round(44 * k)}px "${f.ui}",sans-serif;color:var(--vs-ink);white-space:nowrap;}
.vs-tl-label{font:600 ${Math.round(30 * k)}px "${f.ui}",sans-serif;color:#9a9daa;white-space:nowrap;}
.vs-list{display:flex;flex-direction:column;gap:${Math.round(22 * k)}px;}
.vs-li{display:flex;align-items:center;gap:${Math.round(18 * k)}px;font:700 ${Math.round(44 * k)}px "${f.ui}",sans-serif;}
.vs-type{font:800 ${Math.round(92 * k)}px/1 "${f.ui}",sans-serif;letter-spacing:-.02em;display:flex;align-items:center;}
.vs-type-lead{color:color-mix(in srgb,var(--vs-ink) 55%,var(--vs-bg));}
.vs-type-hi{color:var(--vs-accent);}
.vs-caret{display:inline-block;width:${Math.max(3, Math.round(5 * k))}px;height:${Math.round(96 * k)}px;background:#e9eaee;margin-left:${Math.round(6 * k)}px;}
.vs-doc-zoom{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
.vs-doc-page{position:relative;height:92%;aspect-ratio:0.77;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.35);}
.vs-doc-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.vs-hl{position:absolute;background:var(--vs-hl);mix-blend-mode:multiply;opacity:.75;transform-origin:0 50%;}
.vs-stat{font:900 ${Math.round(200 * k)}px/1 "${f.ui}",sans-serif;color:var(--vs-accent);}
.vs-stat-cap{font:700 ${Math.round(40 * k)}px/1.2 "${f.ui}",sans-serif;color:#c9ccd5;text-align:center;max-width:86%;}
.vs-quote{font:700 ${Math.round(58 * k)}px/1.2 "${f.ui}",sans-serif;text-align:center;max-width:86%;}
.vs-quote-by{font:600 ${Math.round(32 * k)}px "${f.ui}",sans-serif;color:#9a9daa;}
.vs-cta-wrap{position:relative;display:flex;align-items:center;justify-content:center;}
.vs-pill{position:relative;height:${Math.round(150 * k)}px;width:${Math.round(150 * k)}px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 18px 44px rgba(0,0,0,.55);}
.vs-pill-ico{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
.vs-pill-t{position:absolute;font:800 ${Math.round(46 * k)}px "${f.ui}",sans-serif;letter-spacing:.08em;color:#fff;white-space:nowrap;opacity:0;}
.vs-pill-done{color:#d7d9df;}
.vs-cursor{position:absolute;left:50%;top:50%;opacity:0;}
.vs-leak{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at 20% 30%,rgba(255,120,40,.95),transparent 55%),radial-gradient(ellipse at 80% 70%,rgba(255,40,40,.85),transparent 60%),radial-gradient(ellipse at 60% 20%,rgba(255,220,150,.9),transparent 50%);mix-blend-mode:screen;}
.vs-endcard{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(36 * k)}px;}
.vs-end-text{font:800 ${Math.round(64 * k)}px "${f.ui}",sans-serif;}
.vs-search{display:flex;align-items:center;gap:${Math.round(16 * k)}px;background:#fff;color:#111;font:700 ${Math.round(38 * k)}px "${f.ui}",sans-serif;padding:${Math.round(16 * k)}px ${Math.round(36 * k)}px;border-radius:${Math.round(14 * k)}px;box-shadow:-4px 0 0 var(--vs-accent),4px 0 0 var(--vs-danger);}
.vs-search-ico{font-size:${Math.round(44 * k)}px;}
`;
}
