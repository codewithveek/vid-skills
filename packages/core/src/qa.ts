/** Automated, deterministic QA. Runs everywhere and needs no model. */
import { platformSpec } from "./platforms.js";
import type { Asset, Platform, ResearchDossier, Script, Storyboard, Timeline } from "./spec.js";

export interface QaFinding {
  severity: "blocker" | "major" | "minor";
  code: string;
  where?: string;
  message: string;
  fix?: string;
}

export interface QaReport {
  pass: boolean;
  score: number;
  findings: QaFinding[];
  metrics: Record<string, number>;
}

export function runQa(i: {
  script: Script;
  storyboard: Storyboard;
  timeline: Timeline;
  dossier?: ResearchDossier;
  assets: Asset[];
  platforms: Platform[];
  requireSources: boolean;
  licensedOnly: boolean;
  measured?: { lufs?: number; truePeak?: number; durationSec?: number };
}): QaReport {
  const f: QaFinding[] = [];
  const tl = i.timeline;
  const words = i.script.beats.flatMap((b) => b.lines).reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);

  // Headline
  if (tl.headline.length > 42) f.push({ severity: "minor", code: "headline_long", message: `Headline is ${tl.headline.length} chars; ≤ 40 keeps it one large line.`, fix: "Shorten the headline." });

  // Hook
  const first = tl.scenes[0];
  if (!first || first.start > 0.001) f.push({ severity: "blocker", code: "frame0_empty", message: "Frame 0 has no scene (it is the thumbnail and the hook)." });
  // Motion-graphic scenes animate in from an empty stage, so frame 0 (the cover) shows only the chrome.
  else if (["diagram", "typewriter", "stat", "quote", "cta", "endcard"].includes(first.scene.type))
    f.push({ severity: "minor", code: "frame0_weak", where: first.id, message: `Frame 0 opens on a ${first.scene.type} that animates in from empty; the cover shows little.`, fix: "Open on b-roll (a striking still or clip) and move the graphic to the next beat." });
  const hook = i.script.beats[0]?.lines[0]?.text ?? "";
  if (hook.split(/\s+/).length > 14) f.push({ severity: "major", code: "hook_long", where: "l1", message: "First line is long; the viewer decides in ~1 s.", fix: "≤ 12 words." });

  // Rhythm: longest hold on a media scene
  for (const s of tl.scenes) {
    const holdOk = ["diagram", "typewriter", "document", "cta", "endcard", "stat", "quote"].includes(s.scene.type);
    if (!holdOk && s.duration > 6) f.push({ severity: "minor", code: "long_hold", where: s.id, message: `${s.scene.type} shot holds ${s.duration.toFixed(1)} s.`, fix: "Split the shot on a new noun." });
  }
  const cuts = tl.scenes.length;
  const avgShot = tl.durationSec / Math.max(1, cuts);
  if (avgShot > 4) f.push({ severity: "major", code: "slow_pacing", message: `Average shot ${avgShot.toFixed(1)} s; the format targets ~1–3 s.` });

  // Sources
  if (i.requireSources && i.dossier) {
    const known = new Set(i.dossier.claims.map((c) => c.id));
    const weak = new Set(i.dossier.claims.filter((c) => c.confidence === "low").map((c) => c.id));
    for (const b of i.script.beats) {
      if (b.kind === "hook" || b.kind === "cta") continue;
      for (const l of b.lines) {
        if (!l.claimIds.length && /\d|\b(always|never|every|only|first|invented|law|rule|standard)\b/i.test(l.text))
          f.push({ severity: "major", code: "uncited_fact", where: l.id, message: `Factual-sounding line has no claimIds: "${l.text}"` });
        for (const c of l.claimIds) {
          if (!known.has(c)) f.push({ severity: "major", code: "unknown_claim", where: l.id, message: `Line cites unknown claim ${c}.` });
          else if (weak.has(c)) f.push({ severity: "minor", code: "weak_claim", where: l.id, message: `Line relies on low-confidence claim ${c}.` });
        }
      }
    }
  }

  // Assets / rights
  const byId = new Map(i.assets.map((a) => [a.id, a]));
  let placeholders = 0;
  for (const s of tl.scenes) {
    for (const id of s.assets) {
      const a = byId.get(id);
      if (!a) {
        f.push({ severity: "blocker", code: "missing_asset", where: s.id, message: `Asset ${id} is not in the manifest.` });
        continue;
      }
      if (a.provider === "placeholder") placeholders++;
      if (i.licensedOnly && !a.license.commercialUse) f.push({ severity: "blocker", code: "license", where: s.id, message: `Asset ${id} (${a.provider}) is not cleared for commercial use.` });
    }
  }
  if (placeholders) f.push({ severity: placeholders > 3 ? "major" : "minor", code: "placeholders", message: `${placeholders} shot(s) use placeholder cards (no stock/generation provider matched).`, fix: "Configure a stock or image provider, or replace in Studio." });

  // Captions coverage
  if (tl.captions.length) {
    const covered = tl.captions.reduce((n, c) => n + (c.end - c.start), 0);
    const voiced = i.timeline.audio.filter((c) => c.role === "voice").reduce((n, c) => n + (c.duration ?? 0), 0);
    if (voiced && covered / voiced < 0.7) f.push({ severity: "minor", code: "caption_gaps", message: "Captions cover < 70 % of the narration." });
  }

  // Platforms
  for (const p of i.platforms) {
    const spec = platformSpec(p);
    const d = i.measured?.durationSec ?? tl.durationSec;
    if (d > spec.maxSec) f.push({ severity: "blocker", code: "too_long", where: p, message: `${spec.label} allows ≤ ${spec.maxSec}s; video is ${d.toFixed(1)}s.`, fix: "Shorten the script or skip this platform." });
    if (d < spec.minSec) f.push({ severity: "blocker", code: "too_short", where: p, message: `${spec.label} needs ≥ ${spec.minSec}s.` });
  }

  // Loudness
  if (i.measured?.lufs !== undefined && Math.abs(i.measured.lufs - -14) > 2) f.push({ severity: "major", code: "loudness", message: `Integrated loudness ${i.measured.lufs.toFixed(1)} LUFS (target −14 ± 1).` });
  if (i.measured?.truePeak !== undefined && i.measured.truePeak > -0.95) f.push({ severity: "major", code: "true_peak", message: `True peak ${i.measured.truePeak.toFixed(1)} dBTP (limit −1).` });

  const weights = { blocker: 40, major: 10, minor: 3 };
  const score = Math.max(0, 100 - f.reduce((n, x) => n + weights[x.severity], 0));
  return {
    pass: !f.some((x) => x.severity === "blocker"),
    score,
    findings: f,
    metrics: { words, durationSec: tl.durationSec, wpm: words / Math.max(1, tl.durationSec / 60), shots: cuts, avgShotSec: avgShot, captions: tl.captions.length, placeholders },
  };
}
