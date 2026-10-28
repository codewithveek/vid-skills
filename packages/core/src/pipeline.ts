/**
 * The production pipeline. Each stage is a plain async function over the shared
 * context, so it can run:
 *   - in-process (CLI / library: `runPipeline`)
 *   - as durable steps (Cloudflare Workflows: one `step.do` per stage)
 *   - as individual MCP tools driven by any agent.
 * Stages checkpoint their output to storage and are idempotent: a retried or
 * resumed run skips completed stages unless forced.
 */
import { z } from "zod";
import { buildAudioPlan, plannedSfx } from "./audio-plan.js";
import { audioDuration } from "./audio/codec.js";
import { synthSfx } from "./audio/synth.js";
import { compileHyperFrames, type HyperFramesProject } from "./hyperframes/compile.js";
import { generateStructured } from "./llm.js";
import { renderPrompt, type PromptName } from "./prompts.js";
import type { Logger, ProviderSet, Storage, TTSResult, VisualCandidate } from "./providers.js";
import { silentLogger } from "./providers.js";
import { runQa, type QaReport } from "./qa.js";
import {
  Asset,
  JobManifest,
  PublishCopy,
  ResearchDossier,
  Script,
  Storyboard,
  VideoBrief,
  type AssetRequest,
  type Platform,
  type Shot,
  type StageName,
  type Timeline,
  type VideoBriefInput,
  type VoiceTrack,
  type WordTiming,
} from "./spec.js";
import { getStyle } from "./styles/index.js";
import { getJson, putJson } from "./storage.js";
import { buildTimeline } from "./timing.js";
import { estimateWordTimings, guardHallucinations, mapLinesToWords, shiftWords } from "./transcript.js";
import { joinSpeech, remapToDisplay, toSpeech } from "./speech.js";
import { errorMessage, isoNow, newId, normWord, round3, sha256Hex } from "./util.js";
import { documentPage, placeholderCard, svgBytes } from "./visuals.js";

export interface PublishResult {
  status: "published" | "processing" | "failed" | "skipped";
  remoteId?: string;
  url?: string;
  error?: string;
}

export type Publisher = (args: {
  platform: Platform;
  videoKey: string;
  captionsKey?: string;
  thumbnailKey?: string;
  copy: PublishCopy;
  brief: VideoBrief;
  storage: Storage;
}) => Promise<PublishResult>;

export interface PipelineContext {
  providers: ProviderSet;
  storage: Storage;
  logger: Logger;
  jobId: string;
  /** storage prefix for the job, e.g. "jobs/<id>/" */
  base: string;
  signal?: AbortSignal;
  prompts?: Partial<Record<PromptName, string>>;
  concurrency: number;
}

export interface PipelineOptions {
  providers: ProviderSet;
  storage: Storage;
  logger?: Logger;
  jobId?: string;
  prefix?: string;
  signal?: AbortSignal;
  force?: StageName[];
  stopAfter?: StageName;
  publish?: Publisher;
  /** When to publish: only if QA passes (default), always, or never. */
  publishWhen?: "qa-pass" | "always" | "never";
  prompts?: Partial<Record<PromptName, string>>;
  concurrency?: number;
  /** Run an LLM editorial review in QA (costs one call). */
  review?: boolean;
  onProgress?: (stage: StageName, status: "running" | "done" | "skipped" | "failed", info?: Record<string, unknown>) => void;
}

export const STAGE_ORDER: StageName[] = ["research", "script", "storyboard", "voice", "assets", "timeline", "sound", "compose", "render", "qa", "copy", "publish"];

export const storeUri = (key: string) => `store://${key}`;
export const keyFromUri = (uri: string) => (uri.startsWith("store://") ? uri.slice(8) : null);

/* ================================================================== */
/* Stages                                                             */
/* ================================================================== */

export async function stageResearch(ctx: PipelineContext, brief: VideoBrief): Promise<ResearchDossier> {
  const providers = ctx.providers.research ?? [];
  let sources = "";
  if (providers.length) {
    const queries = [brief.topic, `${brief.topic} history origin`, `${brief.topic} how it works explained`];
    if (brief.angle) queries.push(brief.angle);
    const seen = new Set<string>();
    const results: { url: string; title: string; snippet: string; content?: string }[] = [];
    for (const p of providers.slice(0, 2)) {
      for (const q of queries) {
        try {
          for (const r of await p.search(q, { limit: 5, signal: ctx.signal })) {
            if (seen.has(r.url)) continue;
            seen.add(r.url);
            results.push(r);
          }
        } catch (e) {
          ctx.logger.warn(`research: ${p.id} search failed`, { q, error: errorMessage(e) });
        }
      }
    }
    // Read the top pages that came without content.
    const reader = providers.find((p) => p.read);
    for (const r of results.slice(0, 5)) {
      if (r.content || !reader?.read) continue;
      try {
        r.content = (await reader.read(r.url, { signal: ctx.signal })).slice(0, 6000);
      } catch {
        /* snippets are enough */
      }
    }
    sources = results
      .slice(0, 14)
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content ?? r.snippet).slice(0, 2400)}`)
      .join("\n\n");
  }
  return generateStructured({
    llm: ctx.providers.llm,
    schema: ResearchDossier,
    name: "ResearchDossier",
    system: renderPrompt("system", {}, ctx.prompts),
    user: renderPrompt("research", { topic: brief.topic, angle: brief.angle ?? "", audience: brief.audience, language: brief.language, sources }, ctx.prompts),
    example: {
      topic: "power button symbol",
      summary: "…",
      angle: "The power symbol actually means standby",
      claims: [{ id: "c1", text: "IEC 60417-5009 defines the standby symbol.", sources: [{ url: "https://…", title: "IEC 60417" }], confidence: "high" }],
      timeline: [{ year: "1973", event: "IEC publishes the symbols", claimId: "c1" }],
      analogies: ["a light switch vs a doorbell"],
      visualIdeas: ["close-up of a TV remote power key"],
      openQuestions: [],
    },
    signal: ctx.signal,
  });
}

export async function stageScript(ctx: PipelineContext, brief: VideoBrief, dossier: ResearchDossier): Promise<Script> {
  const wpm = brief.voice.targetWpm;
  const wordBudget = Math.round((brief.durationSec * wpm) / 60);
  const script = await generateStructured({
    llm: ctx.providers.llm,
    schema: Script,
    name: "Script",
    system: renderPrompt("system", {}, ctx.prompts),
    user: renderPrompt(
      "script",
      {
        durationSec: brief.durationSec,
        wordBudget,
        wpm,
        dossier: JSON.stringify({ angle: dossier.angle, claims: dossier.claims.map((c) => ({ id: c.id, text: c.text, confidence: c.confidence })), timeline: dossier.timeline, analogies: dossier.analogies }),
        headline: brief.headline ?? "",
        cta: brief.cta ?? "Follow for more things hiding in plain sight.",
        language: brief.language,
      },
      ctx.prompts,
    ),
    example: {
      headline: "Your Power Button Lies",
      beats: [
        { id: "b1", kind: "hook", musicCue: "none", lines: [{ id: "l1", text: "Look at the power button on whatever you're holding.", emphasis: ["power"], claimIds: [], pauseAfterSec: 0.25 }] },
        { id: "b2", kind: "twist", musicCue: "drop", lines: [{ id: "l2", text: "Except it was never a power button.", emphasis: ["never"], claimIds: ["c1"], pauseAfterSec: 0.3 }] },
      ],
      cta: "Follow for more.",
    },
    maxTokens: 6000,
    signal: ctx.signal,
  });
  // Ensure unique line ids across beats (small models sometimes restart numbering).
  const seen = new Set<string>();
  let n = 0;
  for (const b of script.beats)
    for (const l of b.lines) {
      n++;
      if (seen.has(l.id)) l.id = `l${n}x`;
      seen.add(l.id);
    }
  const words = script.beats.flatMap((b) => b.lines).reduce((k, l) => k + l.text.split(/\s+/).filter(Boolean).length, 0);
  if (words > wordBudget * 1.35) ctx.logger.warn("script: over word budget", { words, wordBudget });
  if (brief.headline) script.headline = brief.headline;
  return script;
}

const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it its this that these those you your we our they their there here what when where which who how why not no just even still every all any some more most very can could would should will into over under than then so as if about".split(" "));

/** Deterministic storyboard used when the model can't produce a valid one. */
export function autoStoryboard(script: Script, brief: VideoBrief): Storyboard {
  const shots: Shot[] = [];
  let i = 0;
  for (const beat of script.beats) {
    for (const line of beat.lines) {
      const text = line.text;
      const year = /\b(?:back in|in|by|since)\s+((?:1[5-9]|20)\d{2})\b/i.exec(text);
      const parts = text.split(/,\s*/);
      if (beat.kind === "cta") {
        shots.push({ id: `sh${++i}`, lineId: line.id, scene: { type: "cta", variant: "subscribe-morph", text: "SUBSCRIBE", doneText: "SUBSCRIBED" } });
        continue;
      }
      if (year) {
        const lead = text.slice(year.index, year.index + year[0].length - year[1]!.length).trim();
        shots.push({ id: `sh${++i}`, lineId: line.id, anchor: year[1], scene: { type: "typewriter", lead: lead.charAt(0).toUpperCase() + lead.slice(1), highlight: year[1]!, cps: 12 } });
      }
      if (parts.length >= 3) {
        shots.push({
          id: `sh${++i}`,
          lineId: line.id,
          scene: { type: "montage", perItemSec: 0.22, items: parts.slice(0, 8).map((p) => ({ kind: "image" as const, query: keywords(p).slice(0, 3).join(" ") || p, prefer: "either" as const })) },
        });
        continue;
      }
      const kw = keywords(text);
      shots.push({
        id: `sh${++i}`,
        lineId: line.id,
        anchor: kw[0],
        scene: { type: "broll", asset: { kind: "image", query: kw.slice(0, 3).join(" ") || brief.topic, prompt: `photograph illustrating: ${text}`, prefer: "either" }, treatment: "natural", move: i % 3 === 0 ? "kenBurns" : "pushIn" },
      });
    }
  }
  if (brief.handle) shots.push({ id: `sh${++i}`, lineId: script.beats[script.beats.length - 1]!.lines[0]!.id, scene: { type: "endcard", handle: brief.handle } });
  return { shots };
}

function keywords(s: string): string[] {
  return s
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()));
}

export async function stageStoryboard(ctx: PipelineContext, brief: VideoBrief, script: Script): Promise<Storyboard> {
  const lineIds = new Set(script.beats.flatMap((b) => b.lines.map((l) => l.id)));
  let sb: Storyboard;
  try {
    sb = await generateStructured({
      llm: ctx.providers.llm,
      schema: Storyboard,
      name: "Storyboard",
      system: renderPrompt("system", {}, ctx.prompts),
      user: renderPrompt(
        "storyboard",
        {
          script: JSON.stringify(script.beats.map((b) => ({ beat: b.id, kind: b.kind, lines: b.lines.map((l) => ({ id: l.id, text: l.text })) }))),
          style: getStyle(brief.style).description,
          assetPolicy: brief.licensedOnly ? "Commercially licensed stock or generated images only. No film/TV, no celebrities, no logos as hero." : "Prefer licensed stock or generated images.",
        },
        ctx.prompts,
      ),
      example: {
        shots: [
          { id: "sh1", lineId: "l1", scene: { type: "broll", asset: { kind: "video", query: "hand holding tv remote", prompt: "close-up of a hand holding a TV remote, dark living room" }, treatment: "bw", move: "pushIn" } },
          { id: "sh2", lineId: "l1", anchor: "power", scene: { type: "diagram", template: "icon-draw", data: { icon: "power", color: "#20FFF6", glow: "yes" } } },
        ],
      },
      maxTokens: 8000,
      signal: ctx.signal,
    });
  } catch (e) {
    ctx.logger.warn("storyboard: model failed, using deterministic storyboard", { error: errorMessage(e) });
    return autoStoryboard(script, brief);
  }
  // Repair: drop shots pointing at unknown lines, add a shot for any uncovered line.
  sb.shots = sb.shots.filter((s) => lineIds.has(s.lineId));
  const covered = new Set(sb.shots.map((s) => s.lineId));
  const auto = autoStoryboard(script, brief);
  for (const s of auto.shots) if (!covered.has(s.lineId) && s.scene.type !== "endcard") sb.shots.push({ ...s, id: `${s.id}a` });
  const ids = new Set<string>();
  sb.shots.forEach((s, k) => {
    if (ids.has(s.id)) s.id = `${s.id}-${k}`;
    ids.add(s.id);
  });
  if (brief.handle && !sb.shots.some((s) => s.scene.type === "endcard")) sb.shots.push({ id: "sh-end", lineId: script.beats[script.beats.length - 1]!.lines[0]!.id, scene: { type: "endcard", handle: brief.handle } });
  return sb;
}

export async function stageVoice(ctx: PipelineContext, brief: VideoBrief, script: Script): Promise<{ voice: VoiceTrack; assets: Asset[] }> {
  const tts = ctx.providers.tts;
  const maxChars = Math.max(200, Math.floor(tts.capabilities.maxCharsPerRequest * 0.9));
  type Line = Script["beats"][number]["lines"][number];
  // Chunk by beat, splitting beats that exceed the provider's request limit.
  const chunks: Line[][] = [];
  for (const b of script.beats) {
    let cur: Line[] = [];
    let len = 0;
    for (const l of b.lines) {
      if (cur.length && len + l.text.length + 1 > Math.min(maxChars, 1400)) {
        chunks.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(l);
      len += l.text.length + 1;
    }
    if (cur.length) chunks.push(cur);
  }
  const assets: Asset[] = [];
  const segments: VoiceTrack["segments"] = [];
  const allWords: WordTiming[] = [];
  const spans: VoiceTrack["lineSpans"] = [];
  let t = 0;
  let alignment: VoiceTrack["alignment"] = "provider-word";
  for (let k = 0; k < chunks.length; k++) {
    const lines = chunks[k]!;
    const text = lines.map((l) => l.text).join(" ");
    // What the engine reads (years/numbers spelled out) vs. what captions show (digits kept).
    const speak = (ls: typeof lines | undefined) => (ls ? joinSpeech(ls.map((l) => (brief.voice.normalizeNumbers ? toSpeech(l.text) : { spoken: l.text, map: l.text.split(/\s+/).filter(Boolean).map((d) => ({ display: d, spoken: 1 })) }))) : undefined);
    const sp = speak(lines)!;
    const res: TTSResult = await tts.synthesize({
      text: sp.spoken,
      voice: brief.voice.voice,
      speed: brief.voice.speed,
      language: brief.language,
      instructions: brief.voice.style ?? "Conversational, curious, confident explainer voice. Brisk pace, clear consonants, natural emphasis.",
      previousText: speak(chunks[k - 1])?.spoken,
      nextText: speak(chunks[k + 1])?.spoken,
      signal: ctx.signal,
    });
    const dur = res.durationSec ?? audioDuration(res.bytes, res.mime) ?? (res.words?.length ? res.words[res.words.length - 1]!.end + 0.15 : estimateDuration(text, brief.voice.targetWpm));
    let ws: WordTiming[] | undefined = res.words;
    let how: VoiceTrack["alignment"] = res.alignment === "provider-char" ? "provider-char" : "provider-word";
    if (!ws?.length) {
      if (ctx.providers.stt && res.bytes.length <= ctx.providers.stt.maxBytes) {
        try {
          ws = guardHallucinations((await ctx.providers.stt.transcribe(res, { language: brief.language, prompt: text })).words);
          how = "stt";
        } catch (e) {
          ctx.logger.warn("voice: STT alignment failed, estimating", { error: errorMessage(e) });
        }
      }
      if (!ws?.length) {
        ws = estimateWordTimings(sp.spoken, dur);
        how = "estimated";
      }
    }
    ws = remapToDisplay(ws, sp);
    if (how === "estimated" || (how === "stt" && alignment !== "estimated")) alignment = how;
    else if (how === "provider-char" && alignment === "provider-word") alignment = how;
    const ext = res.mime.includes("mpeg") ? "mp3" : res.mime.includes("ogg") ? "ogg" : "wav";
    const key = `${ctx.base}assets/voice-${k}.${ext}`;
    await ctx.storage.put(key, res.bytes, res.mime);
    const id = `voice-${k}`;
    assets.push({ id, kind: "audio", uri: storeUri(key), mime: res.mime, durationSec: round3(dur), provider: tts.id, license: res.license, role: "voice", sha256: await sha256Hex(res.bytes) });
    segments.push({ assetId: id, start: round3(t), durationSec: round3(dur), lineIds: lines.map((l) => l.id) });
    for (const sp of mapLinesToWords(lines, ws)) spans.push({ lineId: sp.lineId, start: round3(sp.start + t), end: round3(sp.end + t) });
    allWords.push(...shiftWords(ws, t));
    const pause = lines[lines.length - 1]!.pauseAfterSec ?? 0.25;
    t = t + dur + pause;
  }
  const voice: VoiceTrack = { segments, durationSec: round3(t - (chunks.length ? (chunks[chunks.length - 1]!.at(-1)?.pauseAfterSec ?? 0.25) : 0)), words: allWords, alignment, lineSpans: spans };
  return { voice, assets };
}

function estimateDuration(text: string, wpm: number): number {
  return (text.split(/\s+/).length / wpm) * 60 + 0.3;
}

/**
 * Prefer candidates whose title/description mention the query terms (keyless archives such as
 * Wikimedia return loosely related files), keeping provider order as the tie-breaker.
 */
export function rankCandidates(cands: VisualCandidate[], query: string): VisualCandidate[] {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (!terms.length) return cands;
  const score = (c: VisualCandidate) => {
    const text = `${c.description ?? ""} ${c.id}`.toLowerCase();
    return terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0) + (c.description === undefined ? 0.5 : 0);
  };
  const scored = cands.map((c, i) => ({ c, s: score(c), i }));
  const best = Math.max(0, ...scored.map((x) => x.s));
  // With descriptions available, require at least one matching term when any candidate has one.
  return scored.filter((x) => best === 0 || x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

const MAX_DOWNLOAD = 80 * 2 ** 20;

async function download(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url, { signal, redirect: "follow" });
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_DOWNLOAD) throw new Error(`asset too large (${len} bytes)`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new Error("asset too large");
  return { bytes, mime: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim() };
}

export async function stageAssets(ctx: PipelineContext, brief: VideoBrief, storyboard: Storyboard, script: Script): Promise<{ assets: Asset[]; shotAssets: Record<string, string[]> }> {
  const style = getStyle(brief.style);
  const win = style.layout(brief.aspect).window;
  const orientation = win.w > win.h * 1.1 ? "landscape" : win.h > win.w * 1.1 ? "portrait" : "square";
  const usedUrls = new Set<string>();
  // Per-job circuit breaker: a stock provider that errors twice is skipped for the rest of the job.
  const failures = new Map<string, number>();
  const open = (id: string) => (failures.get(id) ?? 0) >= 2;
  const fail = (id: string) => failures.set(id, (failures.get(id) ?? 0) + 1);
  const assets: Asset[] = [];
  const shotAssets: Record<string, string[]> = {};
  const lineText = new Map(script.beats.flatMap((b) => b.lines.map((l) => [l.id, l.text] as const)));

  const resolve = async (req: AssetRequest, id: string, hint: string): Promise<Asset> => {
    if (req.assetId) {
      const existing = assets.find((a) => a.id === req.assetId);
      if (existing) return existing;
    }
    const query = req.query ?? hint;
    // 1. Stock
    if (req.prefer !== "generate" && ctx.providers.stock?.length && query) {
      for (const kind of req.kind === "video" ? (["video", "image"] as const) : (["image"] as const)) {
        for (const sp of ctx.providers.stock.filter((s) => s.kinds.includes(kind) && !open(s.id))) {
          let cands: VisualCandidate[] = [];
          try {
            cands = await sp.search({ query, kind, orientation, limit: 8, signal: ctx.signal });
          } catch (e) {
            fail(sp.id);
            ctx.logger.warn(`assets: ${sp.id} search failed${open(sp.id) ? " (disabled for this job)" : ""}`, { query, error: errorMessage(e) });
            continue;
          }
          const pick = rankCandidates(cands, query).find((c) => !usedUrls.has(c.url) && (!brief.licensedOnly || c.license.commercialUse));
          if (!pick) continue;
          try {
            const dl = await download(pick.url, ctx.signal);
            if (pick.downloadTrackingUrl) fetch(pick.downloadTrackingUrl, { signal: ctx.signal }).catch(() => {});
            usedUrls.add(pick.url);
            const ext = dl.mime.split("/")[1]?.replace("jpeg", "jpg").replace("quicktime", "mov") ?? (kind === "video" ? "mp4" : "jpg");
            const key = `${ctx.base}assets/${id}.${ext}`;
            await ctx.storage.put(key, dl.bytes, dl.mime);
            return { id, kind, uri: storeUri(key), mime: dl.mime, width: pick.width, height: pick.height, durationSec: pick.durationSec, provider: sp.id, query, license: pick.license, role: "visual" };
          } catch (e) {
            ctx.logger.warn("assets: download failed", { url: pick.url, error: errorMessage(e) });
          }
        }
      }
    }
    // 2. Generate
    if (req.prefer !== "stock" && ctx.providers.image && (!brief.licensedOnly || ctx.providers.image.commercialUse)) {
      const prompt = req.prompt ?? `${query}, editorial photograph, natural light, shallow depth of field, no text, no logos`;
      try {
        const w = orientation === "portrait" ? 768 : 1088;
        const h = orientation === "portrait" ? 1344 : 752;
        const img = await ctx.providers.image.generate({ prompt, width: w, height: h, signal: ctx.signal });
        const ext = img.mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
        const key = `${ctx.base}assets/${id}.${ext}`;
        await ctx.storage.put(key, img.bytes, img.mime);
        return { id, kind: "image", uri: storeUri(key), mime: img.mime, width: img.width, height: img.height, provider: ctx.providers.image.id, prompt, license: img.license, role: "visual" };
      } catch (e) {
        ctx.logger.warn("assets: image generation failed", { error: errorMessage(e) });
      }
    }
    // 3. Deterministic placeholder (never fails)
    const key = `${ctx.base}assets/${id}.svg`;
    await ctx.storage.put(key, svgBytes(placeholderCard(query || hint, { accent: style.palette.accent })), "image/svg+xml");
    return { id, kind: "image", uri: storeUri(key), mime: "image/svg+xml", width: 1088, height: 752, provider: "placeholder", query, license: { name: "generated", commercialUse: true, requiresAttribution: false }, role: "visual" };
  };

  await mapLimit(storyboard.shots, ctx.concurrency, async (shot) => {
    const sc = shot.scene;
    const hint = lineText.get(shot.lineId) ?? brief.topic;
    const ids: string[] = [];
    if (sc.type === "broll" || sc.type === "analogy") {
      const a = await resolve(sc.asset, `${shot.id}-a`, hint);
      assets.push(a);
      ids.push(a.id);
    } else if (sc.type === "montage") {
      for (let k = 0; k < sc.items.length; k++) {
        const a = await resolve(sc.items[k]!, `${shot.id}-m${k}`, sc.items[k]!.query ?? hint);
        assets.push(a);
        ids.push(a.id);
      }
    } else if (sc.type === "document") {
      let a: Asset | null = null;
      if (sc.asset.assetId || (sc.asset.prefer === "stock" && sc.asset.query)) a = await resolve(sc.asset, `${shot.id}-d`, hint);
      if (!a) {
        const key = `${ctx.base}assets/${shot.id}-d.svg`;
        const title = sc.asset.query ?? sc.label ?? "Official specification";
        await ctx.storage.put(key, svgBytes(documentPage(title, [hint, sc.asset.prompt ?? ""].filter(Boolean))), "image/svg+xml");
        a = { id: `${shot.id}-d`, kind: "image", uri: storeUri(key), mime: "image/svg+xml", width: 1000, height: 1300, provider: "synthetic-document", license: { name: "generated", commercialUse: true, requiresAttribution: false }, role: "visual" };
      }
      assets.push(a);
      ids.push(a.id);
    }
    shotAssets[shot.id] = ids;
  });
  return { assets, shotAssets };
}

export async function stageSound(
  ctx: PipelineContext,
  brief: VideoBrief,
  script: Script,
  voice: VoiceTrack,
  timeline: Timeline,
): Promise<{ timeline: Timeline; assets: Asset[] }> {
  const style = getStyle(brief.style);
  const assets: Asset[] = [];
  let music: { assetId: string; durationSec: number } | undefined;
  if (brief.music.enabled && ctx.providers.music) {
    const mp = ctx.providers.music;
    const want = Math.min(mp.maxDurationSec, Math.ceil(timeline.durationSec + 2));
    try {
      const res = await mp.generate({ prompt: brief.music.prompt, durationSec: want, instrumental: true, signal: ctx.signal });
      const ext = res.mime.includes("mpeg") ? "mp3" : "wav";
      const key = `${ctx.base}assets/music.${ext}`;
      await ctx.storage.put(key, res.bytes, res.mime);
      const dur = res.durationSec ?? audioDuration(res.bytes, res.mime) ?? want;
      assets.push({ id: "music", kind: "audio", uri: storeUri(key), mime: res.mime, durationSec: round3(dur), provider: mp.id, prompt: brief.music.prompt, license: res.license, role: "music" });
      music = { assetId: "music", durationSec: dur };
    } catch (e) {
      ctx.logger.warn("sound: music generation failed; delivering without a bed", { error: errorMessage(e) });
    }
  }
  const cues = [...new Set(plannedSfx(timeline.scenes, style.fps).map((c) => c.cue))];
  const sfxAssets: Record<string, string[]> = {};
  for (const cue of cues) {
    sfxAssets[cue] = [];
    for (let take = 0; take < 2; take++) {
      const id = `sfx-${normWord(cue) || "fx"}-${take}`;
      let bytes: Uint8Array;
      let mime: string;
      let provider = "procedural";
      let license: Asset["license"] = { name: "generated", commercialUse: true, requiresAttribution: false };
      try {
        if (!ctx.providers.sfx) throw new Error("no sfx provider");
        const r = await ctx.providers.sfx.generate({ cue, durationSec: cue === "riser" ? 1.6 : 0.6, signal: ctx.signal });
        bytes = r.bytes;
        mime = r.mime;
        provider = ctx.providers.sfx.id;
        license = r.license;
      } catch {
        const s = synthSfx(cue, take);
        bytes = s.bytes;
        mime = s.mime;
      }
      const key = `${ctx.base}assets/${id}.${mime.includes("mpeg") ? "mp3" : "wav"}`;
      await ctx.storage.put(key, bytes, mime);
      assets.push({ id, kind: "audio", uri: storeUri(key), mime, provider, license, role: "sfx" });
      sfxAssets[cue]!.push(id);
    }
  }
  const audio = buildAudioPlan({ script, voice, scenes: timeline.scenes, durationSec: timeline.durationSec, style, music, sfxAssets, drops: brief.music.drops });
  return { timeline: { ...timeline, audio }, assets };
}

/* ================================================================== */
/* Orchestration                                                      */
/* ================================================================== */

export interface PipelineResult {
  manifest: JobManifest;
  timeline?: Timeline;
  project?: HyperFramesProject;
  qa?: QaReport;
  copy?: PublishCopy;
}

export async function runPipeline(briefInput: VideoBriefInput, opts: PipelineOptions): Promise<PipelineResult> {
  const brief = VideoBrief.parse(briefInput);
  const jobId = opts.jobId ?? newId("job");
  const base = `${opts.prefix ?? "jobs/"}${jobId}/`;
  const ctx: PipelineContext = {
    providers: opts.providers,
    storage: opts.storage,
    logger: opts.logger ?? silentLogger,
    jobId,
    base,
    signal: opts.signal,
    prompts: opts.prompts,
    concurrency: opts.concurrency ?? 4,
  };
  const manifestKey = `${base}manifest.json`;
  const manifest: JobManifest = (await getJson<JobManifest>(opts.storage, manifestKey)) ?? JobManifest.parse({ id: jobId, createdAt: isoNow(), brief });
  const force = new Set(opts.force ?? []);
  const style = getStyle(brief.style);
  const saveManifest = () => putJson(opts.storage, manifestKey, manifest);

  async function stage<T>(name: StageName, schema: z.ZodType<T> | null, fn: () => Promise<T>): Promise<T> {
    const key = `${base}stages/${name}.json`;
    if (!force.has(name)) {
      const cached = await getJson<T>(opts.storage, key);
      if (cached !== null) {
        opts.onProgress?.(name, "skipped");
        return schema ? schema.parse(cached) : cached;
      }
    }
    const rec = manifest.stages[name] ?? { status: "pending" as const, attempts: 0 };
    rec.status = "running";
    rec.startedAt = isoNow();
    rec.attempts = (rec.attempts ?? 0) + 1;
    manifest.stages[name] = rec;
    await saveManifest();
    opts.onProgress?.(name, "running");
    try {
      const out = await fn();
      await putJson(opts.storage, key, out);
      rec.status = "done";
      rec.finishedAt = isoNow();
      rec.outputKey = key;
      delete rec.error;
      await saveManifest();
      opts.onProgress?.(name, "done");
      return out;
    } catch (e) {
      rec.status = "failed";
      rec.error = errorMessage(e);
      await saveManifest();
      opts.onProgress?.(name, "failed", { error: rec.error });
      throw e;
    }
  }
  const stop = (name: StageName) => opts.stopAfter === name;
  const result: PipelineResult = { manifest };

  const dossier = await stage("research", ResearchDossier, () => stageResearch(ctx, brief));
  if (stop("research")) return result;
  const script = await stage("script", Script, () => stageScript(ctx, brief, dossier));
  if (stop("script")) return result;
  const storyboard = await stage("storyboard", Storyboard, () => stageStoryboard(ctx, brief, script));
  if (stop("storyboard")) return result;
  const voiceOut = await stage("voice", null, () => stageVoice(ctx, brief, script));
  const upsertAssets = (list: Asset[]) => {
    for (const a of list) {
      const i = manifest.assets.findIndex((x) => x.id === a.id);
      if (i >= 0) manifest.assets[i] = a;
      else manifest.assets.push(a);
    }
  };
  upsertAssets(voiceOut.assets);
  if (stop("voice")) return result;
  const visual = await stage("assets", null, () => stageAssets(ctx, brief, storyboard, script));
  upsertAssets(visual.assets);
  if (stop("assets")) return result;
  let timeline = await stage("timeline", null, async () => buildTimeline({ brief, script, storyboard, voice: voiceOut.voice, style, shotAssets: visual.shotAssets }));
  const sound = await stage("sound", null, () => stageSound(ctx, brief, script, voiceOut.voice, timeline));
  upsertAssets(sound.assets);
  timeline = sound.timeline;
  result.timeline = timeline;
  await saveManifest();
  if (stop("sound") || stop("timeline")) return result;

  const project = await stage("compose", null, async () => {
    const p = compileHyperFrames(timeline, { assets: manifest.assets, style, aspect: brief.aspect });
    for (const [path, text] of Object.entries(p.files)) await opts.storage.put(`${base}project/${path}`, text, path.endsWith(".html") ? "text/html" : "application/json");
    return p;
  });
  manifest.outputs.projectKey = `${base}project/`;
  result.project = project;
  const captions = timeline.captions.length ? `${base}captions.srt` : undefined;
  if (captions) {
    const { toSrt } = await import("./captions.js");
    await opts.storage.put(captions, toSrt(timeline.captions), "application/x-subrip");
    manifest.outputs.captionsKey = captions;
  }
  await saveManifest();
  if (stop("compose")) return result;

  let measured: { lufs?: number; truePeak?: number; durationSec?: number } = {};
  if (opts.providers.render) {
    const r = await stage("render", null, async () => {
      const assetKeys: Record<string, string> = {};
      const files: Record<string, string | Uint8Array> = { ...project.files };
      for (const [path, a] of Object.entries(project.assetPaths)) {
        const k = keyFromUri(a.uri);
        if (k) assetKeys[path] = k;
      }
      const out = await opts.providers.render!.render({ files, assetKeys, fps: project.fps, quality: "high", format: "mp4", master: { lufs: style.audio.targetLufs, truePeak: style.audio.truePeakDb }, signal: ctx.signal }, opts.storage, `${base}video.mp4`);
      return { storageKey: out.storageKey ?? `${base}video.mp4`, durationSec: out.durationSec, lufs: out.measuredLufs, truePeak: out.measuredTruePeak };
    });
    manifest.outputs.videoKey = r.storageKey;
    measured = { lufs: r.lufs, truePeak: r.truePeak, durationSec: r.durationSec };
    await saveManifest();
  } else {
    ctx.logger.info("render: no render backend configured; stopping after compose (project is ready to render)");
  }
  if (stop("render")) return result;

  const qa = await stage("qa", null, async () => {
    const report = runQa({ script, storyboard, timeline, dossier, assets: manifest.assets, platforms: brief.platforms, requireSources: brief.requireSources, licensedOnly: brief.licensedOnly, measured });
    if (opts.review) {
      try {
        const Review = z.object({ pass: z.boolean(), score: z.number(), issues: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), where: z.string().optional(), problem: z.string(), fix: z.string().optional() })) });
        const rv = await generateStructured({
          llm: ctx.providers.llmFast ?? ctx.providers.llm,
          schema: Review,
          name: "Review",
          system: renderPrompt("system", {}, ctx.prompts),
          user: renderPrompt("review", { headline: script.headline, script: JSON.stringify(script.beats), storyboard: JSON.stringify(storyboard.shots.map((s) => ({ id: s.id, line: s.lineId, type: s.scene.type, anchor: s.anchor }))), claims: JSON.stringify(dossier.claims), findings: JSON.stringify(report.findings) }, ctx.prompts),
          signal: ctx.signal,
        });
        for (const it of rv.issues) report.findings.push({ severity: it.severity, code: "review", where: it.where, message: it.problem, fix: it.fix });
        report.pass = report.pass && !rv.issues.some((x) => x.severity === "blocker");
      } catch (e) {
        ctx.logger.warn("qa: review failed", { error: errorMessage(e) });
      }
    }
    return report;
  });
  result.qa = qa;

  const copy = await stage("copy", PublishCopy, async () => {
    const c = await generateStructured({
      llm: ctx.providers.llmFast ?? ctx.providers.llm,
      schema: PublishCopy,
      name: "PublishCopy",
      system: renderPrompt("system", {}, ctx.prompts),
      user: renderPrompt("copy", { headline: script.headline, script: script.beats.flatMap((b) => b.lines.map((l) => l.text)).join(" "), sources: dossier.claims.flatMap((c) => c.sources).map((s) => `${s.title} ${s.url}`).join("\n"), platforms: brief.platforms.join(", ") }, ctx.prompts),
      signal: ctx.signal,
    });
    const urls = new Set(c.sources.map((s) => s.url));
    for (const s of dossier.claims.flatMap((x) => x.sources)) if (!urls.has(s.url)) c.sources.push(s);
    // License compliance: credit every asset whose license requires attribution (CC BY, CC BY-SA, Unsplash…).
    const credits = [...new Set(manifest.assets.filter((a) => a.license.requiresAttribution).map((a) => a.license.attribution ?? `${a.provider}: ${a.license.name}`))];
    if (credits.length && !c.description.includes("Credits:")) c.description = `${c.description}\n\nCredits:\n${credits.map((x) => `• ${x}`).join("\n")}`.slice(0, 5000);
    return c;
  });
  result.copy = copy;
  if (stop("copy")) return result;

  const when = opts.publishWhen ?? "qa-pass";
  if (opts.publish && manifest.outputs.videoKey && when !== "never" && (when === "always" || qa.pass)) {
    await stage("publish", null, async () => {
      const pubs: JobManifest["publications"] = [];
      for (const platform of brief.platforms) {
        try {
          const r = await opts.publish!({ platform, videoKey: manifest.outputs.videoKey!, captionsKey: manifest.outputs.captionsKey, copy, brief, storage: opts.storage });
          pubs.push({ platform, status: r.status === "skipped" ? "skipped" : r.status, remoteId: r.remoteId, url: r.url, error: r.error });
        } catch (e) {
          pubs.push({ platform, status: "failed", error: errorMessage(e) });
        }
      }
      manifest.publications = pubs;
      return pubs;
    });
  } else if (opts.publish && !qa.pass) {
    ctx.logger.warn("publish: skipped because QA did not pass", { findings: qa.findings.filter((f) => f.severity === "blocker") });
  }
  await saveManifest();
  return result;
}
