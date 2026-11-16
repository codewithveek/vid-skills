/**
 * "Editorial" (vertical): calm, image-led "science of you" explainers.
 *
 * Warm aubergine page, Fraunces serif headlines with one amber accent word, DM Sans
 * captions in short phrases (key words light up and stay lit), Geist Mono labels, blur
 * crossfades between layouts, and a quiet music bed. No persistent headline band: each
 * layout carries its own type. Palette after Crewcut's "sunset-ink" family.
 */
import type { Aspect } from "../spec.js";
import { EDITORIAL_FONT_FACES } from "./fonts.generated.js";
import { framedExplainer } from "./framed-explainer.js";
import type { StylePack } from "./types.js";

export const editorial: StylePack = {
  id: "editorial",
  name: "Editorial (vertical, calm)",
  description:
    "Image-led vertical explainer: photo heroes with serif headlines, stacked statements, big numbers with citations, ranked lists and ✓/✗ checklists with brush marks; blur crossfades, phrase captions, quiet music bed. Best at 60–90 s.",
  canvas: framedExplainer.canvas,
  fps: 30,
  layout(aspect: Aspect) {
    const c = this.canvas[aspect] ?? this.canvas["9:16"]!;
    const W = c.width;
    const H = c.height;
    const portrait = H > W;
    return {
      window: { x: 0, y: 0, w: W, h: H },
      // Phrase captions sit under the layouts and above the platform buttons/description (≈ 80 %+).
      captions: portrait
        ? { x: Math.round(W * 0.08), y: Math.round(H * 0.735), w: Math.round(W * 0.84), h: Math.round(H * 0.06) }
        : { x: Math.round(W * 0.12), y: Math.round(H * 0.82), w: Math.round(W * 0.76), h: Math.round(H * 0.1) },
      handle: portrait ? { x: Math.round(W * 0.5) - 300, y: Math.round(H * 0.045), w: 600, h: 40 } : { x: W - 560, y: H - 70, w: 520, h: 40 },
      blurFill: false,
    };
  },
  palette: {
    bg: "#16101A",
    card: "#2A1E2C",
    ink: "#FBEEE6",
    muted: "#9B8A92",
    title: "#FFB35C",
    titleStroke: "#16101A",
    accent: "#FFB35C",
    on: "#FFD166",
    standby: "#FF8A5B",
    danger: "#FF7A8C",
    highlight: "#FFB35C",
    tagBg: "#FBEEE6",
    tagInk: "#16101A",
  },
  fonts: { display: "Fraunces", ui: "DM Sans", mono: "Geist Mono", faces: EDITORIAL_FONT_FACES },
  title: { size: 104, weight: 600, strokePx: 0, uppercase: false, letterSpacing: "-0.01em" },
  captions: {
    size: 44,
    weight: 700,
    maxWordsPerCue: 7,
    maxCharsPerCue: 42,
    maxCueSec: 3,
    highlight: "#FFB35C",
    uppercase: false,
    wordGapEm: 0.26,
    mode: "phrase",
  },
  motion: {
    cutLeadSec: 0.12,
    minShotSec: 1.6,
    maxShotSec: 10,
    montagePerItemSec: 0.4,
    ease: "vs-entrance",
    drawOnSec: 0.6,
    transition: { type: "blur-crossfade", sec: 0.5 },
  },
  audio: { targetLufs: -14, truePeakDb: -1, bedUnderVoice: 0.09, bedNoVoice: 0.3, sfxGain: 0.35, voiceGain: 1 },
  poster: { uppercase: false, stroke: false, glyphEm: 0.5, kicker: "THE SCIENCE OF YOU" },
};
