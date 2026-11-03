import { framedExplainer } from "./framed-explainer.js";
import type { StylePack } from "./types.js";

export type { StylePack, Box } from "./types.js";
export { framedExplainer };

/**
 * Full-bleed variant: the same scene vocabulary with media filling the canvas and
 * big centred captions (no persistent headline). Useful for platforms or brands
 * that dislike framed layouts.
 */
export const fullBleed: StylePack = {
  ...framedExplainer,
  id: "full-bleed",
  name: "Full-bleed captions",
  description: "Edge-to-edge media, large word-by-word captions in the centre third, no persistent headline.",
  layout(aspect) {
    const c = this.canvas[aspect] ?? this.canvas["9:16"]!;
    const W = c.width;
    const H = c.height;
    return {
      window: { x: 0, y: 0, w: W, h: H },
      captions: { x: Math.round(W * 0.08), y: Math.round(H * 0.58), w: Math.round(W * 0.84), h: Math.round(H * 0.1) },
      handle: { x: W - 520, y: Math.round(H * 0.74), w: 480, h: 40 },
      blurFill: false,
    };
  },
  captions: { ...framedExplainer.captions, size: 72, maxWordsPerCue: 3, uppercase: true },
};

const registry = new Map<string, StylePack>([
  [framedExplainer.id, framedExplainer],
  [fullBleed.id, fullBleed],
]);

export function registerStyle(style: StylePack): void {
  registry.set(style.id, style);
}

export function getStyle(id: string): StylePack {
  const s = registry.get(id);
  if (!s) throw new Error(`unknown style "${id}". Known: ${[...registry.keys()].join(", ")}`);
  return s;
}

export function listStyles(): { id: string; name: string; description: string }[] {
  return [...registry.values()].map((s) => ({ id: s.id, name: s.name, description: s.description }));
}
