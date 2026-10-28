import type { Aspect } from "../spec.js";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StylePack {
  id: string;
  name: string;
  description: string;
  /** Production canvases per aspect ratio. */
  canvas: Partial<Record<Aspect, { width: number; height: number }>>;
  fps: number;
  /** Layout, in pixels for each canvas. */
  layout(aspect: Aspect): {
    /** Persistent headline band */
    title?: Box;
    /** Content window that scenes render into */
    window: Box;
    /** Caption band (inside the window or below) */
    captions: Box;
    /** Watermark/handle position */
    handle?: Box;
    /** Whether the background is a blurred copy of the window media */
    blurFill: boolean;
  };
  palette: Record<
    "bg" | "card" | "ink" | "muted" | "title" | "titleStroke" | "accent" | "on" | "standby" | "danger" | "highlight" | "tagBg" | "tagInk",
    string
  >;
  fonts: {
    /** Display (headline) family: must be bundled by HyperFrames or shipped as @font-face */
    display: string;
    ui: string;
    mono: string;
    /** Extra @font-face CSS (fonts shipped in assets/fonts) */
    faces?: string;
  };
  title: { size: number; weight: number; strokePx: number; uppercase: boolean; letterSpacing: string };
  captions: {
    size: number;
    weight: number;
    maxWordsPerCue: number;
    maxCharsPerCue: number;
    maxCueSec: number;
    highlight: string;
    uppercase: boolean;
    /** Gap between caption words, in em. Explicit because thick text strokes eat normal spaces. */
    wordGapEm?: number;
  };
  motion: {
    /** Seconds the cut leads the anchor word (negative = after). The reference lands visuals on the word. */
    cutLeadSec: number;
    minShotSec: number;
    maxShotSec: number;
    montagePerItemSec: number;
    ease: string;
    drawOnSec: number;
  };
  audio: {
    targetLufs: number;
    truePeakDb: number;
    /** linear gain for the music bed under voice (HyperFrames data-volume) */
    bedUnderVoice: number;
    bedNoVoice: number;
    sfxGain: number;
    voiceGain: number;
  };
}
