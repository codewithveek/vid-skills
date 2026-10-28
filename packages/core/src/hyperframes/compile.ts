/**
 * Timeline → HyperFrames project.
 *
 * Output layout (all editable in the HyperFrames desktop app / Studio):
 *   index.html                 root composition: scene hosts, chrome, captions, audio
 *   compositions/<scene>.html  one sub-composition per shot (template + paused timeline)
 *   compositions/chrome.html   persistent headline band + handle watermark
 *   compositions/captions.html word-synced captions
 *   assets/...                 media (materialized by the renderer from `assetPaths`)
 */
import type { Asset, AudioClip, Timeline } from "../spec.js";
import type { StylePack } from "../styles/types.js";
import { attrJson, escapeHtml as e, round3 } from "../util.js";
import { renderScene, sharedCss, type SceneAsset } from "./scenes.js";

export interface CompileOptions {
  /** GSAP script URL. Point at a vendored copy (assets/vendor/gsap.min.js) for hermetic renders. */
  gsapSrc?: string;
  /** Asset id -> asset record (must include every asset referenced by the timeline) */
  assets: Asset[];
  style: StylePack;
  aspect: "9:16" | "16:9" | "1:1" | "4:5";
}

export interface HyperFramesProject {
  entry: "index.html";
  /** text files of the project */
  files: Record<string, string>;
  /** project-relative path -> Asset (the renderer copies asset.uri bytes to this path) */
  assetPaths: Record<string, Asset>;
  /** derived files the renderer generates with ffmpeg: path -> { from: source path, op } (also written to vidsk.derived.json) */
  derived: Record<string, { from: string; op: "blur-bg" }>;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_GSAP = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/flac": "flac",
  "font/woff2": "woff2",
};

export function assetFileName(a: Asset): string {
  const fromMime = a.mime ? EXT[a.mime.split(";")[0]!.trim()] : undefined;
  const fromUri = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(a.uri)?.[1]?.toLowerCase();
  const ext = fromMime ?? fromUri ?? (a.kind === "video" ? "mp4" : a.kind === "audio" ? "wav" : "jpg");
  const dir = a.kind === "audio" ? "audio" : a.kind === "video" ? "video" : a.kind === "font" ? "fonts" : "img";
  return `assets/${dir}/${a.id}.${ext}`;
}

const sceneId = (id: string) => `s-${id}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);

export function compileHyperFrames(tl: Timeline, opts: CompileOptions): HyperFramesProject {
  const { style } = opts;
  const width = tl.width;
  const height = tl.height;
  const layout = style.layout(opts.aspect);
  const gsap = opts.gsapSrc ?? DEFAULT_GSAP;
  const byId = new Map(opts.assets.map((a) => [a.id, a]));
  const assetPaths: Record<string, Asset> = {};
  const pathOf = (id: string): SceneAsset | undefined => {
    const a = byId.get(id);
    if (!a) return undefined;
    const p = assetFileName(a);
    assetPaths[p] = a;
    return { path: p, asset: a };
  };

  const files: Record<string, string> = {};
  const hosts: string[] = [];
  const derived: HyperFramesProject["derived"] = {};
  const derive = (from: SceneAsset, op: "blur-bg"): string | null => {
    if (from.asset.mime?.includes("svg") || from.path.endsWith(".svg")) return null; // ffmpeg can't rasterize SVG reliably
    const out = from.path.replace(/\.[a-z0-9]+$/i, from.asset.kind === "video" ? ".bg.mp4" : ".bg.jpg");
    derived[out] = { from: from.path, op };
    return out;
  };

  tl.scenes.forEach((ts, i) => {
    const sid = sceneId(ts.id);
    const assets = ts.assets.map(pathOf).filter((x): x is SceneAsset => !!x);
    const out = renderScene({ sid, ts, style, width, height, blurFill: layout.blurFill, assets, fps: tl.fps, derive });
    files[`compositions/${sid}.html`] = sceneFile(sid, width, height, out.css, out.html, out.js);
    hosts.push(
      `<div id="${sid}" data-composition-id="${sid}" data-composition-src="compositions/${sid}.html" data-start="${round3(ts.start)}" data-duration="${round3(ts.duration)}" data-track-index="1" data-track-kind="graphics" data-width="${width}" data-height="${height}" style="z-index:${1 + (i % 2)}"></div>`,
    );
  });

  // Persistent chrome: headline band + handle.
  files["compositions/chrome.html"] = chromeFile(tl, style, layout, width, height);
  hosts.push(
    `<div id="chrome" data-composition-id="chrome" data-composition-src="compositions/chrome.html" data-start="0" data-duration="${round3(tl.durationSec)}" data-track-index="3" data-track-kind="graphics" data-width="${width}" data-height="${height}" data-variable-values="${attrJson({ headline: tl.headline, handle: tl.handle ?? "" })}" style="z-index:20"></div>`,
  );

  if (tl.captions.length) {
    files["compositions/captions.html"] = captionsFile(tl, style, layout.captions, width, height);
    hosts.push(
      `<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${round3(tl.durationSec)}" data-track-index="4" data-track-kind="captions" data-width="${width}" data-height="${height}" style="z-index:30"></div>`,
    );
  }

  const audioTags = tl.audio.map((c, i) => audioTag(c, pathOf(c.assetId), i)).filter(Boolean);

  files["index.html"] = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <meta name="generator" content="vid-skills" />
    <script src="${e(gsap)}"></script>
    <style>${sharedCss(style, layout.window, width, height)}${style.fonts.faces ?? ""}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${round3(tl.durationSec)}" data-width="${width}" data-height="${height}" data-fps="${tl.fps}">
      ${hosts.join("\n      ")}
      ${audioTags.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

  files["vidsk.timeline.json"] = JSON.stringify(tl, null, 2);
  files["vidsk.derived.json"] = JSON.stringify(derived, null, 2);
  files["README.md"] = `# ${tl.headline}\n\nGenerated by vid-skills. Preview: \`npx hyperframes preview\` · Check: \`npx hyperframes check --json\` · Render: \`npx hyperframes render -o out.mp4\`.\n\nAssets are listed in \`vidsk.assets.json\` with their licenses.\n`;
  files["vidsk.assets.json"] = JSON.stringify(
    Object.entries(assetPaths).map(([path, a]) => ({ path, id: a.id, provider: a.provider, license: a.license, query: a.query, prompt: a.prompt })),
    null,
    2,
  );

  return { entry: "index.html", files, assetPaths, derived, durationSec: tl.durationSec, width, height, fps: tl.fps };
}

function sceneFile(sid: string, w: number, h: number, css: string, html: string, js: string): string {
  return `<template>
  <style>
    #root { position: absolute; inset: 0; overflow: hidden; }
    ${css}
  </style>
  <div id="root" data-composition-id="${sid}" data-width="${w}" data-height="${h}">
    ${html}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      ${js}
      window.__timelines = window.__timelines || {};
      window.__timelines["${sid}"] = tl;
    })();
  </script>
</template>
`;
}

function chromeFile(tl: Timeline, style: StylePack, layout: ReturnType<StylePack["layout"]>, w: number, h: number): string {
  const p = style.palette;
  const t = layout.title;
  const k = w / 1080;
  // Fit the headline on one line: League Gothic averages ~0.40 em per glyph.
  const chars = Math.max(8, tl.headline.length);
  const fit = Math.floor((w * 0.9) / (chars * 0.4));
  const size = Math.min(Math.round(style.title.size * 1.25 * k), fit);
  const vars = [
    { id: "headline", type: "string", label: "Headline", default: tl.headline, maxLength: 60 },
    { id: "handle", type: "string", label: "Handle", default: tl.handle ?? "" },
  ];
  const title = t
    ? `<div class="vs-title-band" style="top:${t.y}px;height:${t.h}px;"><h1 id="chrome-title" data-var-text="headline">${e(tl.headline)}</h1></div>`
    : "";
  const handle = tl.handle && layout.handle ? `<div id="chrome-handle" data-var-text="handle" style="left:${layout.handle.x}px;top:${layout.handle.y}px;width:${layout.handle.w}px;">${e(tl.handle)}</div>` : "";
  return `<template>
  <style>
    #root { position: absolute; inset: 0; pointer-events: none; }
    .vs-title-band { position: absolute; left: 0; right: 0; display: flex; align-items: center; justify-content: center; }
    #chrome-title { font-family: "${style.fonts.display}", "Oswald", "Archivo Black", sans-serif; font-weight: ${style.title.weight}; font-size: ${size}px; line-height: 1; letter-spacing: ${style.title.letterSpacing}; color: ${p.title}; -webkit-text-stroke: ${style.title.strokePx * 2}px ${p.titleStroke}; paint-order: stroke fill; text-shadow: 0 ${Math.round(3 * k)}px ${Math.round(6 * k)}px rgba(0,0,0,.45); white-space: nowrap; ${style.title.uppercase ? "text-transform: uppercase;" : ""} }
    #chrome-handle { position: absolute; text-align: right; font: 700 ${Math.round(30 * k)}px "${style.fonts.ui}", sans-serif; color: rgba(255,255,255,.85); text-shadow: 0 1px 3px rgba(0,0,0,.6); }
  </style>
  <div id="root" data-composition-id="chrome" data-width="${w}" data-height="${h}" data-composition-variables="${attrJson(vars)}" data-layout-allow-overlap>
    ${title}
    ${handle}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      window.__timelines = window.__timelines || {};
      window.__timelines["chrome"] = tl;
    })();
  </script>
</template>
`;
}

function captionsFile(tl: Timeline, style: StylePack, box: { x: number; y: number; w: number; h: number }, w: number, h: number): string {
  const c = style.captions;
  const k = w / 1080;
  const size = Math.round(c.size * k);
  let html = "";
  let js = "";
  tl.captions.forEach((cue, i) => {
    const id = `cap-c${i}`;
    const words = cue.words
      .map((wd, j) => `<span id="${id}-w${j}" class="vs-w${cue.emphasis.includes(j) ? " vs-w-em" : ""}">${e(c.uppercase ? wd.text.toUpperCase() : wd.text)}</span>`)
      .join(" ");
    html += `<div id="${id}" class="clip vs-cue" data-start="${round3(cue.start)}" data-duration="${round3(Math.max(0.05, cue.end - cue.start))}"><div id="${id}-in" class="vs-cue-in">${words}</div></div>`;
    js += `tl.fromTo("#${id}-in", {y:${Math.round(10 * k)}, opacity:0}, {y:0, opacity:1, duration:0.1, ease:"power2.out"}, ${round3(cue.start)});`;
    cue.words.forEach((wd, j) => {
      const emph = cue.emphasis.includes(j);
      js += `tl.fromTo("#${id}-w${j}", {color:"#FFFFFF", scale:1}, {color:"${c.highlight}", scale:1.08, duration:0.06}, ${round3(wd.start)});`;
      if (!emph) js += `tl.fromTo("#${id}-w${j}", {color:"${c.highlight}", scale:1.08}, {color:"#FFFFFF", scale:1, duration:0.06, immediateRender:false}, ${round3(Math.max(wd.start + 0.07, wd.end))});`;
    });
  });
  return `<template>
  <style>
    #root { position: absolute; inset: 0; pointer-events: none; }
    .vs-cue { position: absolute; left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px; display: flex; align-items: center; justify-content: center; }
    .vs-cue-in { text-align: center; font: ${c.weight} ${size}px/1.1 "${style.fonts.ui}", sans-serif; color: #fff; -webkit-text-stroke: ${Math.max(2, Math.round(8 * k))}px #000; paint-order: stroke fill; text-shadow: 0 ${Math.round(4 * k)}px ${Math.round(10 * k)}px rgba(0,0,0,.55); }
    .vs-w { display: inline-block; }
    .vs-w-em { color: ${c.highlight}; }
  </style>
  <div id="root" data-composition-id="captions" data-width="${w}" data-height="${h}" data-layout-allow-caption-zone>
    ${html}
  </div>
  <script>
    (function () {
      const tl = gsap.timeline({ paused: true });
      ${js}
      window.__timelines = window.__timelines || {};
      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`;
}

function audioTag(c: AudioClip, a: SceneAsset | undefined, i: number): string {
  if (!a) return "";
  const attrs: string[] = [
    `id="a-${c.id}"`.replace(/[^\w"=-]/g, "-"),
    `class="clip"`,
    `src="${e(a.path)}"`,
    `data-start="${round3(c.start)}"`,
    `data-track-index="${10 + i}"`,
    `data-volume="${round3(c.volume)}"`,
  ];
  if (c.duration) attrs.push(`data-duration="${round3(c.duration)}"`);
  if (c.mediaStart) attrs.push(`data-media-start="${round3(c.mediaStart)}"`);
  if (c.fadeIn) attrs.push(`data-fade-in="${round3(c.fadeIn)}"`);
  if (c.fadeOut) attrs.push(`data-fade-out="${round3(c.fadeOut)}"`);
  if (c.automation.length) attrs.push(`data-automation="${attrJson({ version: 1, lanes: [{ target: "volume", points: c.automation }] })}"`);
  if (c.role === "voice")
    attrs.push(
      `data-fx-chain="${attrJson({
        version: 1,
        nodes: [
          { type: "highpass", id: "vhp", label: "Remove rumble", params: { frequency: 80 } },
          { type: "limiter", id: "vlim", label: "Peak safety", params: { limit: -1 } },
        ],
      })}"`,
    );
  attrs.push(`data-audio-group="${c.role}"`);
  return `<audio ${attrs.join(" ")}></audio>`;
}
