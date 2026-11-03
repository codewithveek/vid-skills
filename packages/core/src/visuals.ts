/**
 * Deterministic SVG visuals used as last-resort fallbacks (no stock hit, no image
 * model) and for synthetic documents. They keep a hands-free run from failing and
 * look intentional (dark UI cards in the style palette) rather than broken.
 */
import { escapeHtml as e, hashString, seededRandom } from "./util.js";

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if ((line + " " + w).trim().length > max) {
      if (line) out.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export function placeholderCard(text: string, opts: { width?: number; height?: number; accent?: string } = {}): string {
  const W = opts.width ?? 1088;
  const H = opts.height ?? 752;
  const r = seededRandom(hashString(text));
  const hue = Math.floor(r() * 360);
  const lines = wrap(text, 22).slice(0, 4);
  const fs = Math.round(H / 9);
  const y0 = H / 2 - ((lines.length - 1) * fs * 1.15) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="g" cx="35%" cy="30%" r="90%"><stop offset="0" stop-color="hsl(${hue},28%,22%)"/><stop offset="1" stop-color="#0A090E"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
${Array.from({ length: 14 }, (_, i) => `<circle cx="${Math.round(r() * W)}" cy="${Math.round(r() * H)}" r="${Math.round(20 + r() * 120)}" fill="hsl(${(hue + i * 9) % 360},60%,60%)" opacity="${(0.03 + r() * 0.05).toFixed(3)}"/>`).join("")}
${lines.map((l, i) => `<text x="${W / 2}" y="${Math.round(y0 + i * fs * 1.15)}" text-anchor="middle" dominant-baseline="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="${fs}" fill="#F4F5F7">${e(l)}</text>`).join("")}
<rect x="${W / 2 - 60}" y="${Math.round(y0 + lines.length * fs * 1.15)}" width="120" height="6" rx="3" fill="${opts.accent ?? "#4CC0E4"}"/>
</svg>`;
}

/** A plausible standards/legal document page with the given heading and paragraphs. */
export function documentPage(title: string, paragraphs: string[], opts: { width?: number; height?: number } = {}): string {
  const W = opts.width ?? 1000;
  const H = opts.height ?? 1300;
  let y = 150;
  const body: string[] = [];
  for (const p of paragraphs.slice(0, 6)) {
    for (const l of wrap(p, 58)) {
      body.push(`<text x="90" y="${y}" font-family="Georgia,serif" font-size="30" fill="#222">${e(l)}</text>`);
      y += 42;
      if (y > H - 120) break;
    }
    y += 26;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="90" y="95" font-family="Arial,sans-serif" font-weight="700" font-size="40" fill="#111">${e(title)}</text>
<line x1="90" y1="115" x2="${W - 90}" y2="115" stroke="#999" stroke-width="2"/>
${body.join("\n")}
</svg>`;
}

export function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}
