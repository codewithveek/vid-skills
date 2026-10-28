/**
 * "Framed explainer": the format measured in docs/audit/power-button-explainer.md.
 *
 * 1080×1920 · persistent red headline at 17.6–19.9 % height · full-width 16:11
 * content window at 25.5–64.1 % · blur-fill background · dark UI motion graphics.
 */
import type { Aspect } from "../spec.js";
import type { StylePack } from "./types.js";

export const framedExplainer: StylePack = {
  id: "framed-explainer",
  name: "Framed explainer (vertical)",
  description:
    "Persistent headline + 16:11 media window over a blurred fill. Literal b-roll on anchor words, 0.2 s enumeration montages, dark-UI diagrams with stroke draw-on, typewriter year cards, labelled analogy inserts, music drops before twists, subscribe morph CTA.",
  canvas: {
    "9:16": { width: 1080, height: 1920 },
    "4:5": { width: 1080, height: 1350 },
    "1:1": { width: 1080, height: 1080 },
    "16:9": { width: 1920, height: 1080 },
  },
  fps: 30,
  layout(aspect: Aspect) {
    const c = this.canvas[aspect] ?? this.canvas["9:16"]!;
    const W = c.width;
    const H = c.height;
    if (aspect === "16:9") {
      // Landscape: headline top-left band, window centred at 16:9 inside safe area.
      const winH = Math.round(H * 0.74);
      const winW = Math.round((winH * 16) / 9);
      return {
        title: { x: 0, y: Math.round(H * 0.035), w: W, h: Math.round(H * 0.09) },
        window: { x: Math.round((W - winW) / 2), y: Math.round(H * 0.15), w: winW, h: winH },
        captions: { x: Math.round(W * 0.1), y: Math.round(H * 0.78), w: Math.round(W * 0.8), h: Math.round(H * 0.1) },
        handle: { x: W - 360, y: H - 70, w: 320, h: 40 },
        blurFill: true,
      };
    }
    // Vertical / portrait / square: measured bands from the reference (scaled).
    const winY = Math.round(H * 0.2547); // 489 / 1920
    const winH = Math.round((W * 11) / 16); // 742 for 1080 wide
    return {
      title: { x: 0, y: Math.round(H * 0.168), w: W, h: Math.round(H * 0.045) },
      window: { x: 0, y: winY, w: W, h: Math.min(winH, H - winY - Math.round(H * 0.12)) },
      // Captions sit just under the window, above the platform caption/UI zone (≤ 1330 px on 1920).
      captions: { x: Math.round(W * 0.08), y: winY + winH + Math.round(H * 0.02), w: Math.round(W * 0.84), h: Math.round(H * 0.07) },
      handle: { x: W - 300, y: Math.round(H * 0.74), w: 260, h: 40 },
      blurFill: true,
    };
  },
  palette: {
    bg: "#0A090E",
    card: "#16171D",
    ink: "#F4F5F7",
    muted: "#3A3D45",
    title: "#D20922",
    titleStroke: "#FFFFFF",
    accent: "#4CC0E4",
    on: "#20FFF6",
    standby: "#FF9F1C",
    danger: "#E50914",
    highlight: "#FFD400",
    tagBg: "#FFFFFF",
    tagInk: "#0B0B0F",
  },
  fonts: {
    // League Gothic / Oswald / Archivo Black are bundled with HyperFrames (no @font-face needed).
    display: "League Gothic",
    ui: "Inter",
    mono: "JetBrains Mono",
  },
  title: { size: 64, weight: 400, strokePx: 3, uppercase: false, letterSpacing: "0.005em" },
  captions: { size: 50, weight: 900, maxWordsPerCue: 4, maxCharsPerCue: 24, maxCueSec: 1.6, highlight: "#FFD400", uppercase: false },
  motion: { cutLeadSec: 0.033, minShotSec: 0.18, maxShotSec: 8, montagePerItemSec: 0.22, ease: "power3.out", drawOnSec: 0.6 },
  audio: { targetLufs: -14, truePeakDb: -1, bedUnderVoice: 0.14, bedNoVoice: 0.45, sfxGain: 0.6, voiceGain: 1 },
};
