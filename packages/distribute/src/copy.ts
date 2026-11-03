/** Adapt one PublishCopy to each platform's text rules (lengths, hashtags, escaping, URL weighting). */
import { platformSpec, truncateWords, type Platform, type PublishCopy } from "@vid-skills/core";

export interface PlatformText {
  title?: string;
  text: string;
  tags?: string[];
}

const clean = (t: string) => t.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "");
const tagList = (c: PublishCopy, max: number) => [...new Set(c.hashtags.map(clean).filter(Boolean))].slice(0, max);

/** X counts URLs as 23 and CJK/emoji as 2 (weighted length). */
export function xWeightedLength(s: string): number {
  let n = 0;
  const noUrls = s.replace(/https?:\/\/\S+/g, () => {
    n += 23;
    return "";
  });
  for (const ch of noUrls) {
    const cp = ch.codePointAt(0)!;
    n += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2;
  }
  return n;
}

/** LinkedIn "little text format": reserved characters must be escaped; hashtags use a template. */
export function linkedinEscape(s: string): string {
  return s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

function graphemes(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].length : [...s].length;
}

function fit(parts: string[], max: number, measure: (s: string) => number = (s) => s.length): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    const cand = [...out, p].join("\n\n");
    if (measure(cand) <= max) out.push(p);
    else if (!out.length) return truncateWords(p, max);
  }
  return out.join("\n\n");
}

export function adaptCopy(platform: Platform, c: PublishCopy): PlatformText {
  const spec = platformSpec(platform);
  const hook = c.hook ?? c.title;
  const sources = c.sources.length ? `Sources:\n${c.sources.slice(0, 5).map((s) => s.url).join("\n")}` : "";
  switch (platform) {
    case "youtube":
    case "youtube_shorts": {
      const title = truncateWords(c.title.replace(/[<>]/g, ""), 100);
      const tags: string[] = [];
      let total = 0;
      for (const t of [...c.hashtags.map(clean), ...c.keywords]) {
        if (!t || total + t.length + 1 > 480) continue;
        tags.push(t);
        total += t.length + 1;
      }
      const hs = tagList(c, 3).map((t) => `#${t}`).join(" ");
      return { title, text: fit([c.description.replace(/[<>]/g, ""), sources, hs], 5000), tags };
    }
    case "tiktok":
    case "instagram_reels":
    case "facebook_reels": {
      const hs = tagList(c, platform === "instagram_reels" ? 5 : 6).map((t) => `#${t}`).join(" ");
      const max = spec.text.captionMax;
      return { text: fit([hook, c.description.split("\n")[0] ?? "", hs], max) };
    }
    case "x": {
      const hs = tagList(c, 2).map((t) => `#${t}`).join(" ");
      const base = `${hook}${hs ? ` ${hs}` : ""}`;
      if (xWeightedLength(base) <= 280) return { text: base };
      let h = hook;
      while (h.length > 10 && xWeightedLength(h + "…") > 280) h = h.slice(0, Math.floor(h.length * 0.9));
      return { text: truncateWords(h, h.length) };
    }
    case "linkedin": {
      const tags = tagList(c, 5).map((t) => `{hashtag|\\#|${t}}`).join(" ");
      const body = fit([linkedinEscape(hook), linkedinEscape(c.description), linkedinEscape(sources)], 2900);
      return { text: tags ? `${body}\n\n${tags}` : body };
    }
    case "threads":
      return { text: fit([hook, tagList(c, 1).map((t) => `#${t}`).join("")], 500) };
    case "pinterest":
      return { title: truncateWords(c.title, 100), text: truncateWords(`${c.description}`, 800) };
    case "bluesky": {
      const hs = tagList(c, 2).map((t) => `#${t}`).join(" ");
      const t = `${hook} ${hs}`.trim();
      return { text: graphemes(t) <= 300 ? t : truncateWords(hook, 290) };
    }
    default:
      return { text: c.description };
  }
}
