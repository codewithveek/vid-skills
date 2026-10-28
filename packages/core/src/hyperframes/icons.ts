/**
 * Stroke icons (24×24, round caps) used by diagram scenes. Every path carries
 * pathLength="1" so a draw-on is a deterministic stroke-dashoffset 1 → 0 tween.
 * Shapes follow IEC 60417 where one exists (5007 on, 5008 off, 5009 standby/power, 5010 on/off).
 */
export const ICONS: Record<string, string[]> = {
  // IEC 60417-5009: broken circle + line ("standby", now generic power)
  power: ["M7.05 6.05a8 8 0 1 0 9.9 0", "M12 3v8"],
  standby: ["M7.05 6.05a8 8 0 1 0 9.9 0", "M12 3v8"],
  // IEC 60417-5010: closed circle with the line inside (true on/off)
  onoff: ["M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16", "M12 7v10"],
  // IEC 60417-5007 / 5008
  on: ["M12 4v16"],
  off: ["M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16"],
  moon: ["M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"],
  check: ["M5 12.5l4.2 4.2L19 7"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  wifi: ["M2.5 9a14 14 0 0 1 19 0", "M5.5 12.5a9.5 9.5 0 0 1 13 0", "M8.8 16a4.8 4.8 0 0 1 6.4 0", "M12 19.5h.01"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 9a3 3 0 1 1 0 6a3 3 0 1 1 0-6"],
  lock: ["M6 11h12v10H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  cpu: ["M7 7h10v10H7z", "M10 3v4", "M14 3v4", "M10 17v4", "M14 17v4", "M3 10h4", "M3 14h4", "M17 10h4", "M17 14h4"],
  battery: ["M3 8h16v8H3z", "M21 11v2", "M6 11h6"],
  globe: ["M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18", "M3 12h18", "M12 3c3 3.2 3 14.8 0 18", "M12 3c-3 3.2-3 14.8 0 18"],
  clock: ["M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18", "M12 7.5V12l3 2"],
  warning: ["M12 3l10 18H2z", "M12 10v5", "M12 18h.01"],
  arrow: ["M4 12h16", "M14 6l6 6-6 6"],
  plug: ["M9 2v6", "M15 2v6", "M6 8h12v4a6 6 0 0 1-12 0z", "M12 18v4"],
  remote: ["M8 2h8v20H8z", "M12 5.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3", "M10.5 12h3", "M10.5 15h3", "M10.5 18h3"],
  user: ["M12 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8", "M4 21a8 8 0 0 1 16 0"],
  dollar: ["M12 2v20", "M17 6.5C16 5 14.2 4.5 12 4.5c-3 0-5 1.4-5 3.5 0 5 10 2.5 10 8 0 2.1-2 3.5-5 3.5-2.4 0-4.4-.8-5.3-2.5"],
};

export function iconSvg(name: string, id: string, opts: { size: number; color: string; stroke?: number; glow?: string }): string {
  const paths = ICONS[name] ?? ICONS.power!;
  const sw = opts.stroke ?? 1.8;
  const filter = opts.glow ? ` style="filter: drop-shadow(0 0 10px ${opts.glow}) drop-shadow(0 0 22px ${opts.glow});"` : "";
  return `<svg id="${id}" class="vs-icon" width="${opts.size}" height="${opts.size}" viewBox="0 0 24 24" fill="none" stroke="${opts.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${filter}>${paths
    .map((d, i) => `<path id="${id}-p${i}" d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0"/>`)
    .join("")}</svg>`;
}
