/**
 * Canonical data model for the whole pipeline.
 *
 * Every stage reads and writes these shapes, every provider and agent speaks
 * them, and they are exported as JSON Schema (see `jsonSchemas`) so that any
 * model or tool, whether or not it understands TypeScript, can produce valid input.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/i, "ids are alphanumeric with - or _");

export const Platform = z.enum([
  "youtube",
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "linkedin",
  "threads",
  "pinterest",
  "bluesky",
]);
export type Platform = z.infer<typeof Platform>;

export const Aspect = z.enum(["9:16", "16:9", "1:1", "4:5"]);
export type Aspect = z.infer<typeof Aspect>;

export const License = z.object({
  name: z.string().describe("SPDX id or license name, e.g. CC0-1.0, Pexels, ElevenLabs-Commercial"),
  url: z.string().optional(),
  attribution: z.string().optional().describe("Credit line that must be shown/kept if required"),
  commercialUse: z.boolean().default(true),
  requiresAttribution: z.boolean().default(false),
});
export type License = z.infer<typeof License>;

/* ------------------------------------------------------------------ */
/* Brief                                                               */
/* ------------------------------------------------------------------ */

export const VoicePreference = z.object({
  provider: z.string().optional().describe("Provider id, e.g. kokoro, elevenlabs, openai, cartesia"),
  voice: z.string().optional().describe("Provider voice id, e.g. am_michael (Kokoro) or a voice UUID"),
  speed: z.number().min(0.5).max(2).default(1.08),
  style: z.string().optional().describe("Free-text delivery direction for models that accept it"),
  targetWpm: z.number().min(90).max(240).default(170),
  normalizeNumbers: z.boolean().default(true).describe("Spell out years/numbers for the TTS engine (1868 → 'eighteen sixty-eight'); captions keep digits"),
});

export const MusicPreference = z.object({
  enabled: z.boolean().default(true),
  provider: z.string().optional(),
  prompt: z
    .string()
    .default("minimal dark tech pulse, subtle analog synth drone, light percussion, no vocals, 118 bpm, loopable"),
  bedLufs: z.number().default(-28),
  drops: z.boolean().default(true).describe("Cut the bed to silence right before twist beats"),
});

export const PosterPreference = z.object({
  mode: z
    .enum(["off", "on", "both"])
    .optional()
    .describe("off: no poster; on: the video opens on the poster; both (default): the main video has none and a poster variant is rendered alongside for A/B tests"),
  /** Legacy switch: true = "on", false = "off" (used when `mode` is absent). */
  enabled: z.boolean().optional(),
  durationSec: z.number().min(0.1).max(3).default(0.6).describe("How long the poster holds before revealing the video (the voice starts underneath)"),
  text: z.string().max(80).optional().describe("Poster headline; defaults to the video headline"),
  kicker: z.string().max(30).default("DID YOU KNOW?").describe("Small tag above the headline; empty string hides it"),
});
export type PosterPreference = z.infer<typeof PosterPreference>;

/** Resolve the poster mode (the main video opened straight into the hook performed better, so "both" keeps it clean and adds a variant). */
export function posterMode(p: Partial<PosterPreference> | undefined): "off" | "on" | "both" {
  return p?.mode ?? (p?.enabled === true ? "on" : p?.enabled === false ? "off" : "both");
}

export const VideoBrief = z.object({
  topic: z.string().min(3),
  angle: z.string().optional().describe("The counter-intuitive claim the video proves"),
  audience: z.string().default("curious general audience, phone viewers"),
  language: z.string().default("en"),
  durationSec: z.number().min(10).max(900).default(75),
  aspect: Aspect.default("9:16"),
  style: z.string().default("framed-explainer"),
  headline: z.string().max(60).optional().describe("Persistent on-screen title; generated when absent"),
  platforms: z.array(Platform).default(["youtube_shorts", "tiktok", "instagram_reels"]),
  voice: VoicePreference.default({ speed: 1.08, targetWpm: 170, normalizeNumbers: true }),
  music: MusicPreference.default({
    enabled: true,
    prompt: "minimal dark tech pulse, subtle analog synth drone, light percussion, no vocals, 118 bpm, loopable",
    bedLufs: -28,
    drops: true,
  }),
  captions: z.boolean().default(true),
  poster: PosterPreference.default({ durationSec: 0.6, kicker: "DID YOU KNOW?" }),
  cta: z.string().optional().describe("Call to action, ideally reusing the topic's metaphor"),
  handle: z.string().optional().describe("Creator handle shown as watermark / end card"),
  licensedOnly: z.boolean().default(true).describe("Refuse assets without a commercial-use license"),
  requireSources: z.boolean().default(true).describe("Every factual line must cite a research claim"),
  notes: z.string().optional(),
});
export type VideoBrief = z.infer<typeof VideoBrief>;
export type VideoBriefInput = z.input<typeof VideoBrief>;

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

export const Source = z.object({
  url: z.string(),
  title: z.string().default(""),
  publisher: z.string().optional(),
  quote: z.string().optional().describe("Verbatim supporting excerpt"),
  retrievedAt: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const Claim = z.object({
  id: Id,
  text: z.string(),
  sources: z.array(Source).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
});
export type Claim = z.infer<typeof Claim>;

export const ResearchDossier = z.object({
  topic: z.string(),
  summary: z.string(),
  angle: z.string().describe("The single surprising thesis"),
  claims: z.array(Claim).min(1),
  timeline: z.array(z.object({ year: z.string(), event: z.string(), claimId: z.string().optional() })).default([]),
  analogies: z.array(z.string()).default([]),
  visualIdeas: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});
export type ResearchDossier = z.infer<typeof ResearchDossier>;

/* ------------------------------------------------------------------ */
/* Script                                                              */
/* ------------------------------------------------------------------ */

export const BeatKind = z.enum([
  "hook",
  "stakes",
  "twist",
  "history",
  "mechanism",
  "proof",
  "payoff",
  "cta",
]);
export type BeatKind = z.infer<typeof BeatKind>;

export const ScriptLine = z.object({
  id: Id,
  text: z.string().min(1).describe("Exactly what the narrator says"),
  emphasis: z.array(z.string()).default([]).describe("Words to highlight in captions"),
  claimIds: z.array(z.string()).default([]),
  pauseAfterSec: z.number().min(0).max(2).default(0.25),
});
export type ScriptLine = z.infer<typeof ScriptLine>;

export const Beat = z.object({
  id: Id,
  kind: BeatKind,
  lines: z.array(ScriptLine).min(1),
  musicCue: z.enum(["none", "drop", "swell", "resume"]).default("none"),
});
export type Beat = z.infer<typeof Beat>;

export const Script = z.object({
  headline: z.string().min(3).max(60),
  beats: z.array(Beat).min(1),
  cta: z.string().optional(),
});
export type Script = z.infer<typeof Script>;

/* ------------------------------------------------------------------ */
/* Scenes: the visual vocabulary measured in the reference audit       */
/* ------------------------------------------------------------------ */

export const MediaTreatment = z.enum(["natural", "bw", "dark", "warm", "cool", "vintage"]);
export const CameraMove = z.enum(["static", "pushIn", "pullOut", "panLeft", "panRight", "kenBurns"]);

/** An asset is referenced by id (resolved later) or described by a query/prompt to resolve. */
export const AssetRequest = z.object({
  assetId: z.string().optional(),
  kind: z.enum(["image", "video"]).default("image"),
  query: z.string().optional().describe("Stock search query"),
  prompt: z.string().optional().describe("Generation prompt when stock fails or is disallowed"),
  prefer: z.enum(["stock", "generate", "either"]).default("either"),
});
export type AssetRequest = z.infer<typeof AssetRequest>;

const SceneBase = z.object({
  label: z.string().optional().describe("White tag shown on the media, e.g. 'Tech Industry'"),
  sfx: z.string().optional().describe("Sound effect cue id: click, whoosh, pop, tick, riser, impact, swipe"),
});

export const BrollScene = SceneBase.extend({
  type: z.literal("broll"),
  asset: AssetRequest,
  treatment: MediaTreatment.default("natural"),
  move: CameraMove.default("pushIn"),
  /** Vertical crop focus for media taller than the window: 0 keeps the top (faces in portraits), 1 the bottom. Default centre. */
  focusY: z.number().min(0).max(1).optional(),
});

export const MontageScene = SceneBase.extend({
  type: z.literal("montage"),
  items: z.array(AssetRequest).min(2).max(16),
  perItemSec: z.number().min(0.12).max(1).default(0.22),
  /** Item start times relative to the shot (computed by the timing engine from the list words). */
  itemTimes: z.array(z.number()).optional(),
});

export const DiagramScene = SceneBase.extend({
  type: z.literal("diagram"),
  template: z.enum([
    "icon-draw",
    "button-cards",
    "toggle-switch",
    "flow",
    "compare",
    "counter",
    "timeline",
    "checklist",
  ]),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const TypewriterScene = SceneBase.extend({
  type: z.literal("typewriter"),
  lead: z.string().describe("Dim lead-in, e.g. 'Back in'"),
  highlight: z.string().describe("Accent word, e.g. '1973'"),
  cps: z.number().min(4).max(40).default(12),
});

export const DocumentScene = SceneBase.extend({
  type: z.literal("document"),
  asset: AssetRequest,
  highlights: z
    .array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }))
    .default([])
    .describe("Normalised (0..1) boxes to highlight in order"),
  pageTurn: z.boolean().default(true),
  zoomTo: z.object({ x: z.number(), y: z.number(), scale: z.number().min(1).max(4) }).optional(),
});

export const AnalogyScene = SceneBase.extend({
  type: z.literal("analogy"),
  asset: AssetRequest,
  caption: z.string().describe("Tag text naming the analogy"),
});

export const StatScene = SceneBase.extend({
  type: z.literal("stat"),
  value: z.string(),
  caption: z.string(),
  sourceClaimId: z.string().optional(),
});

export const QuoteScene = SceneBase.extend({
  type: z.literal("quote"),
  text: z.string(),
  attribution: z.string().optional(),
});

export const CtaScene = SceneBase.extend({
  type: z.literal("cta"),
  variant: z.enum(["subscribe-morph", "follow-card"]).default("subscribe-morph"),
  text: z.string().default("SUBSCRIBE"),
  doneText: z.string().default("SUBSCRIBED"),
});

export const EndCardScene = SceneBase.extend({
  type: z.literal("endcard"),
  handle: z.string().optional(),
  text: z.string().optional(),
});

export const VersusSide = z.object({
  asset: AssetRequest.optional().describe("Photo for this side (preferred: real images beat icons)"),
  icon: z.string().optional().describe("Fallback when there is no photo: any Lucide icon name, e.g. 'bug', 'scroll-text'"),
  title: z.string().max(16).describe("Big year, number or word, e.g. '1878'"),
  label: z.string().max(48).describe("Short caption under the title"),
});
export type VersusSide = z.infer<typeof VersusSide>;

export const VersusScene = SceneBase.extend({
  type: z.literal("versus"),
  left: VersusSide,
  right: VersusSide,
  winner: z.enum(["left", "right", "none"]).default("right").describe("Side that gets the highlight ring"),
});

export const Scene = z.discriminatedUnion("type", [
  BrollScene,
  VersusScene,
  MontageScene,
  DiagramScene,
  TypewriterScene,
  DocumentScene,
  AnalogyScene,
  StatScene,
  QuoteScene,
  CtaScene,
  EndCardScene,
]);
export type Scene = z.infer<typeof Scene>;
export type SceneType = Scene["type"];

export const Shot = z.object({
  id: Id,
  lineId: z.string().describe("Script line this shot illustrates"),
  anchor: z.string().optional().describe("Word/phrase in the line the cut lands on"),
  scene: Scene,
});
export type Shot = z.infer<typeof Shot>;

export const Storyboard = z.object({
  shots: z.array(Shot).min(1),
});
export type Storyboard = z.infer<typeof Storyboard>;

/* ------------------------------------------------------------------ */
/* Audio / alignment                                                   */
/* ------------------------------------------------------------------ */

export const WordTiming = z.object({
  text: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  confidence: z.number().min(0).max(1).optional(),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const VoiceTrack = z.object({
  /** One clip per synthesized chunk, placed back-to-back (no decoding/concatenation needed on Workers). */
  segments: z.array(z.object({ assetId: z.string(), start: z.number(), durationSec: z.number(), lineIds: z.array(z.string()) })).min(1),
  durationSec: z.number(),
  words: z.array(WordTiming),
  alignment: z.enum(["provider-word", "provider-char", "stt", "estimated"]),
  lineSpans: z.array(z.object({ lineId: z.string(), start: z.number(), end: z.number() })),
});
export type VoiceTrack = z.infer<typeof VoiceTrack>;

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export const Asset = z.object({
  id: Id,
  kind: z.enum(["image", "video", "audio", "font", "svg", "document"]),
  /** storage key (preferred), https URL, or data: URI */
  uri: z.string(),
  mime: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  provider: z.string(),
  query: z.string().optional(),
  prompt: z.string().optional(),
  license: License,
  sha256: z.string().optional(),
  role: z.enum(["visual", "voice", "music", "sfx", "font", "other"]).default("visual"),
});
export type Asset = z.infer<typeof Asset>;

/* ------------------------------------------------------------------ */
/* Resolved timeline: frame-exact, consumed by the HyperFrames compiler */
/* ------------------------------------------------------------------ */

export const TimedScene = z.object({
  id: Id,
  start: z.number(),
  duration: z.number().positive(),
  scene: Scene,
  /** resolved asset ids used by this scene, in order */
  assets: z.array(z.string()).default([]),
  lineId: z.string().optional(),
});
export type TimedScene = z.infer<typeof TimedScene>;

export const CaptionCue = z.object({
  start: z.number(),
  end: z.number(),
  words: z.array(WordTiming),
  emphasis: z.array(z.number()).default([]).describe("Indices into words to highlight"),
});
export type CaptionCue = z.infer<typeof CaptionCue>;

export const AutomationPoint = z.object({ t: z.number(), v: z.number() });

export const AudioClip = z.object({
  id: Id,
  assetId: z.string(),
  role: z.enum(["voice", "music", "sfx"]),
  start: z.number(),
  duration: z.number().optional(),
  mediaStart: z.number().default(0),
  volume: z.number().min(0).max(4).default(1),
  fadeIn: z.number().default(0),
  fadeOut: z.number().default(0),
  automation: z.array(AutomationPoint).default([]),
});
export type AudioClip = z.infer<typeof AudioClip>;

export const Timeline = z.object({
  fps: z.number().int().min(12).max(60).default(30),
  width: z.number().int(),
  height: z.number().int(),
  durationSec: z.number().positive(),
  headline: z.string(),
  handle: z.string().optional(),
  scenes: z.array(TimedScene),
  captions: z.array(CaptionCue).default([]),
  audio: z.array(AudioClip).default([]),
  style: z.string(),
  /** Opening poster frame: hook text over the hero image, shown from frame 0. */
  poster: z
    .object({
      text: z.string(),
      kicker: z.string().default(""),
      /** Words of `text` drawn in the highlight colour */
      highlight: z.array(z.string()).default([]),
      /** Image asset for the poster; the compiler picks the sharpest b-roll still when absent */
      heroAssetId: z.string().optional(),
      durationSec: z.number().positive(),
    })
    .optional(),
});
export type Timeline = z.infer<typeof Timeline>;

/* ------------------------------------------------------------------ */
/* Publishing copy                                                     */
/* ------------------------------------------------------------------ */

export const PublishCopy = z.object({
  title: z.string().max(100),
  description: z.string().max(5000),
  hashtags: z.array(z.string()).max(30).default([]),
  keywords: z.array(z.string()).default([]),
  hook: z.string().optional().describe("First line for caption-led platforms"),
  altText: z.string().optional(),
  pinnedComment: z
    .string()
    .max(500)
    .optional()
    .describe("First comment to post and pin: an honest, specific either/or question that invites viewers to pick a side"),
  sources: z.array(Source).default([]),
});
export type PublishCopy = z.infer<typeof PublishCopy>;

/* ------------------------------------------------------------------ */
/* Job manifest: the durable record a pipeline run checkpoints         */
/* ------------------------------------------------------------------ */

export const StageName = z.enum([
  "research",
  "script",
  "storyboard",
  "voice",
  "assets",
  "sound",
  "timeline",
  "compose",
  "render",
  "qa",
  "copy",
  "publish",
]);
export type StageName = z.infer<typeof StageName>;

export const StageRecord = z.object({
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  attempts: z.number().default(0),
  error: z.string().optional(),
  outputKey: z.string().optional(),
  provider: z.string().optional(),
  costUsd: z.number().optional(),
});
export type StageRecord = z.infer<typeof StageRecord>;

export const JobManifest = z.object({
  id: z.string(),
  createdAt: z.string(),
  brief: VideoBrief,
  stages: z.record(z.string(), StageRecord).default({}),
  assets: z.array(Asset).default([]),
  outputs: z
    .object({
      projectKey: z.string().optional(),
      videoKey: z.string().optional(),
      captionsKey: z.string().optional(),
      thumbnailKey: z.string().optional(),
      /** Alternate cuts rendered alongside the main video (e.g. "poster" when brief.poster.mode is "both"). */
      variants: z.record(z.string(), z.object({ projectKey: z.string().optional(), videoKey: z.string().optional() })).optional(),
    })
    .default({}),
  publications: z
    .array(
      z.object({
        platform: Platform,
        status: z.enum(["queued", "uploading", "processing", "published", "failed", "skipped"]),
        remoteId: z.string().optional(),
        url: z.string().optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
});
export type JobManifest = z.infer<typeof JobManifest>;

/** JSON Schemas for every contract, so non-TypeScript models and tools can produce valid payloads. */
export function jsonSchemas(): Record<string, unknown> {
  const all = {
    VideoBrief,
    ResearchDossier,
    Script,
    Storyboard,
    Scene,
    Timeline,
    PublishCopy,
    JobManifest,
    Asset,
    VoiceTrack,
  } as const;
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(all)) {
    out[name] = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  }
  return out;
}
