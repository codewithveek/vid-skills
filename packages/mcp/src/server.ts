/**
 * Transport-agnostic MCP server (JSON-RPC 2.0). Exposes the whole video
 * pipeline as tools, the audit/limits/skills/schemas as resources, and ready-made
 * prompts. Use it over stdio (CLI), Streamable HTTP (Workers/Node) or call
 * `handle()` directly from any host.
 */
import { z } from "zod";
import {
  allPlatformSpecs,
  compileHyperFrames,
  getJson,
  getStyle,
  jsonSchemas,
  listStyles,
  putJson,
  ResearchDossier,
  runPipeline,
  runQa,
  Script,
  Storyboard,
  Timeline,
  VideoBrief,
  Asset,
  PublishCopy,
  Platform,
  type JobManifest,
  type ProviderSet,
  type Publisher,
  type Storage,
  type StageName,
  type PipelineResult,
  STAGE_ORDER,
  newId,
  stageResearch,
  stageScript,
  stageStoryboard,
  silentLogger,
} from "@vid-skills/core";
import { describeProviders, PROVIDER_LIMITS } from "@vid-skills/providers";
import { adaptCopy } from "@vid-skills/distribute";
import { DOCS } from "./docs.generated.js";

export const SERVER_INFO = { name: "vid-skills", version: "0.1.0" };
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpContext {
  /** Lazily build providers (throws ConfigError with guidance when unconfigured). */
  providers: () => ProviderSet;
  storage: Storage;
  prefix?: string;
  publish?: Publisher;
  /** Start a durable background job (Workflows / queue). Without it, jobs run inline. */
  startJob?: (args: { jobId: string; brief: z.input<typeof VideoBrief>; stopAfter?: StageName; publish: boolean }) => Promise<void>;
  /** Optional Node-only capability: deep audit of a reference video. */
  audit?: (args: { url?: string; key?: string; transcribe?: boolean }) => Promise<unknown>;
  /** Public URL for a stored object (signed/R2 public), used in tool results. */
  urlFor?: (key: string) => Promise<string | null>;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  run: (args: never, ctx: McpContext) => Promise<unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

const jobBase = (ctx: McpContext, id: string) => `${ctx.prefix ?? "jobs/"}${id}/`;

async function summarize(ctx: McpContext, m: JobManifest | null, res?: PipelineResult) {
  if (!m) return null;
  const url = async (k?: string) => (k && ctx.urlFor ? await ctx.urlFor(k) : undefined);
  return {
    jobId: m.id,
    stages: Object.fromEntries(Object.entries(m.stages).map(([k, v]) => [k, v.status + (v.error ? `: ${v.error}` : "")])),
    outputs: { ...m.outputs, videoUrl: await url(m.outputs.videoKey), captionsUrl: await url(m.outputs.captionsKey) },
    publications: m.publications,
    qa: res?.qa ? { pass: res.qa.pass, score: res.qa.score, findings: res.qa.findings.slice(0, 20) } : undefined,
    copy: res?.copy,
  };
}

async function runJob(ctx: McpContext, jobId: string, brief: z.input<typeof VideoBrief>, stopAfter: StageName | undefined, publish: boolean, force?: StageName[]) {
  const res = await runPipeline(brief, { providers: ctx.providers(), storage: ctx.storage, prefix: ctx.prefix, jobId, stopAfter, force, publish: publish ? ctx.publish : undefined, logger: silentLogger });
  return summarize(ctx, res.manifest, res);
}

const BriefArg = VideoBrief;
const StageArg = z.enum(STAGE_ORDER as [StageName, ...StageName[]]);

export const TOOLS: Tool[] = [
  {
    name: "make_video",
    title: "Make a video end-to-end",
    description:
      "Research → script → storyboard → voice-over → assets → sound design → HyperFrames composition → render → QA → copy → (optional) publish. Returns a jobId; poll job_status. Use stopAfter to stop early (e.g. 'compose' to get an editable HyperFrames project without rendering).",
    input: z.object({ brief: BriefArg, publish: z.boolean().default(false), stopAfter: StageArg.optional(), wait: z.boolean().default(false).describe("Run inline and wait (only for short jobs or hosts without background jobs)") }),
    annotations: { openWorldHint: true },
    run: async (a: { brief: z.input<typeof VideoBrief>; publish: boolean; stopAfter?: StageName; wait: boolean }, ctx) => {
      const jobId = newId("job");
      if (ctx.startJob && !a.wait) {
        await ctx.startJob({ jobId, brief: a.brief, stopAfter: a.stopAfter, publish: a.publish });
        return { jobId, status: "queued", next: "Call job_status with this jobId." };
      }
      return runJob(ctx, jobId, a.brief, a.stopAfter, a.publish);
    },
  },
  {
    name: "job_status",
    title: "Job status",
    description: "Stage-by-stage status, outputs (video/captions/project keys and URLs), QA and publications for a job.",
    input: z.object({ jobId: z.string() }),
    annotations: { readOnlyHint: true },
    run: async (a: { jobId: string }, ctx) => {
      const base = jobBase(ctx, a.jobId);
      const m = await getJson<JobManifest>(ctx.storage, `${base}manifest.json`);
      if (!m) throw new Error(`unknown job ${a.jobId}`);
      const qa = await getJson<PipelineResult["qa"]>(ctx.storage, `${base}stages/qa.json`);
      const copy = await getJson<PipelineResult["copy"]>(ctx.storage, `${base}stages/copy.json`);
      return summarize(ctx, m, { manifest: m, qa: qa ?? undefined, copy: copy ?? undefined });
    },
  },
  {
    name: "resume_job",
    title: "Resume or re-run part of a job",
    description: "Continue a job from its checkpoints, optionally forcing stages to re-run (e.g. after editing the script with save_stage).",
    input: z.object({ jobId: z.string(), force: z.array(StageArg).default([]), stopAfter: StageArg.optional(), publish: z.boolean().default(false) }),
    run: async (a: { jobId: string; force: StageName[]; stopAfter?: StageName; publish: boolean }, ctx) => {
      const m = await getJson<JobManifest>(ctx.storage, `${jobBase(ctx, a.jobId)}manifest.json`);
      if (!m) throw new Error(`unknown job ${a.jobId}`);
      return runJob(ctx, a.jobId, m.brief, a.stopAfter, a.publish, a.force);
    },
  },
  {
    name: "research_topic",
    title: "Research a topic",
    description: "Search + read sources and return a cited research dossier (claims with confidence, timeline, analogies, visual ideas).",
    input: z.object({ brief: BriefArg }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a: { brief: z.input<typeof VideoBrief> }, ctx) => stageResearch(stageCtx(ctx), VideoBrief.parse(a.brief)),
  },
  {
    name: "write_script",
    title: "Write the narration script",
    description: "Write a beat-structured script (hook, stakes, twist, history/mechanism, proof, payoff, CTA) from a dossier, with claim ids and caption emphasis.",
    input: z.object({ brief: BriefArg, dossier: ResearchDossier }),
    run: async (a: { brief: z.input<typeof VideoBrief>; dossier: z.infer<typeof ResearchDossier> }, ctx) => stageScript(stageCtx(ctx), VideoBrief.parse(a.brief), a.dossier),
  },
  {
    name: "plan_storyboard",
    title: "Plan the storyboard",
    description: "Turn a script into shots (broll, montage, diagram, typewriter, document, analogy, stat, quote, cta, endcard) anchored to words.",
    input: z.object({ brief: BriefArg, script: Script }),
    run: async (a: { brief: z.input<typeof VideoBrief>; script: z.infer<typeof Script> }, ctx) => stageStoryboard(stageCtx(ctx), VideoBrief.parse(a.brief), a.script),
  },
  {
    name: "save_stage",
    title: "Save/override a stage output",
    description: "Write a stage checkpoint for a job (e.g. your own script or storyboard), then resume_job to build from it. Creates the job if it doesn't exist.",
    input: z.object({ jobId: z.string().optional(), brief: BriefArg.optional(), stage: z.enum(["research", "script", "storyboard"]), data: z.unknown() }),
    run: async (a: { jobId?: string; brief?: z.input<typeof VideoBrief>; stage: "research" | "script" | "storyboard"; data: unknown }, ctx) => {
      const schema = { research: ResearchDossier, script: Script, storyboard: Storyboard }[a.stage];
      const data = schema.parse(a.data);
      const jobId = a.jobId ?? newId("job");
      const base = jobBase(ctx, jobId);
      let m = await getJson<JobManifest>(ctx.storage, `${base}manifest.json`);
      if (!m) {
        if (!a.brief) throw new Error("brief is required for a new job");
        m = { id: jobId, createdAt: new Date().toISOString(), brief: VideoBrief.parse(a.brief), stages: {}, assets: [], outputs: {}, publications: [] };
      }
      m.stages[a.stage] = { status: "done", attempts: 0, finishedAt: new Date().toISOString(), outputKey: `${base}stages/${a.stage}.json` };
      // Downstream stages must be recomputed.
      const after = STAGE_ORDER.slice(STAGE_ORDER.indexOf(a.stage) + 1);
      for (const s of after) {
        delete m.stages[s];
        await ctx.storage.delete?.(`${base}stages/${s}.json`);
      }
      await putJson(ctx.storage, `${base}stages/${a.stage}.json`, data);
      await putJson(ctx.storage, `${base}manifest.json`, m);
      return { jobId, saved: a.stage, next: "resume_job" };
    },
  },
  {
    name: "get_project_file",
    title: "Read a HyperFrames project file",
    description: "Read a file of a job's composed HyperFrames project (index.html, compositions/*.html, vidsk.timeline.json…). Omit path to list files.",
    input: z.object({ jobId: z.string(), path: z.string().optional() }),
    annotations: { readOnlyHint: true },
    run: async (a: { jobId: string; path?: string }, ctx) => {
      const base = `${jobBase(ctx, a.jobId)}project/`;
      if (!a.path) return (await ctx.storage.list(base)).map((o) => o.key.slice(base.length));
      const t = await ctx.storage.getText(base + a.path.replace(/^\/+/, ""));
      if (t === null) throw new Error(`no such file ${a.path}`);
      return t;
    },
  },
  {
    name: "put_project_file",
    title: "Edit a HyperFrames project file",
    description: "Overwrite a project file (HTML/CSS/GSAP edits). Then call render_job to re-render. Keep the HyperFrames contract: class=clip + data-start/data-duration, paused timelines registered on window.__timelines, no Date.now/Math.random.",
    input: z.object({ jobId: z.string(), path: z.string().regex(/^[\w./-]+$/).refine((p) => !p.includes(".."), "no parent paths"), content: z.string() }),
    annotations: { destructiveHint: true },
    run: async (a: { jobId: string; path: string; content: string }, ctx) => {
      const key = `${jobBase(ctx, a.jobId)}project/${a.path.replace(/^\/+/, "")}`;
      await ctx.storage.put(key, a.content, a.path.endsWith(".html") ? "text/html" : "text/plain");
      const base = jobBase(ctx, a.jobId);
      // A manual edit invalidates the render and everything after it.
      for (const s of ["render", "qa", "copy", "publish"]) await ctx.storage.delete?.(`${base}stages/${s}.json`);
      return { saved: key };
    },
  },
  {
    name: "render_job",
    title: "Render a job's project",
    description: "Render (or re-render after edits) the job's HyperFrames project to MP4 with mastered audio, then run QA.",
    input: z.object({ jobId: z.string() }),
    run: async (a: { jobId: string }, ctx) => {
      const m = await getJson<JobManifest>(ctx.storage, `${jobBase(ctx, a.jobId)}manifest.json`);
      if (!m) throw new Error(`unknown job ${a.jobId}`);
      const providers = ctx.providers();
      if (!providers.render) throw new Error("no render backend configured (VIDSK_RENDER, or run via the CLI/Worker which provide one)");
      const base = jobBase(ctx, a.jobId);
      const keys = (await ctx.storage.list(`${base}project/`)).map((o) => o.key);
      const files: Record<string, string> = {};
      for (const k of keys) files[k.slice(`${base}project/`.length)] = (await ctx.storage.getText(k)) ?? "";
      const project = JSON.parse(files["vidsk.assets.json"] ?? "[]") as { path: string; id: string }[];
      const assetKeys: Record<string, string> = {};
      for (const p of project) {
        const asset = m.assets.find((x) => x.id === p.id);
        if (asset?.uri.startsWith("store://")) assetKeys[p.path] = asset.uri.slice(8);
      }
      const style = getStyle(m.brief.style);
      const out = await providers.render.render({ files, assetKeys, fps: style.fps, quality: "high", master: { lufs: style.audio.targetLufs, truePeak: style.audio.truePeakDb } }, ctx.storage, `${base}video.mp4`);
      m.outputs.videoKey = out.storageKey;
      await putJson(ctx.storage, `${base}manifest.json`, m);
      await putJson(ctx.storage, `${base}stages/render.json`, { storageKey: out.storageKey, durationSec: out.durationSec, lufs: out.measuredLufs, truePeak: out.measuredTruePeak });
      return { videoKey: out.storageKey, videoUrl: ctx.urlFor ? await ctx.urlFor(out.storageKey!) : undefined, durationSec: out.durationSec, lufs: out.measuredLufs, truePeak: out.measuredTruePeak };
    },
  },
  {
    name: "compile_timeline",
    title: "Compile a timeline to HyperFrames",
    description: "Pure function: Timeline + Assets → HyperFrames project files (index.html + compositions). For agents that build timelines themselves.",
    input: z.object({ timeline: Timeline, assets: z.array(Asset), aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16") }),
    annotations: { readOnlyHint: true },
    run: async (a: { timeline: z.infer<typeof Timeline>; assets: z.infer<typeof Asset>[]; aspect: "9:16" | "16:9" | "1:1" | "4:5" }) => {
      const p = compileHyperFrames(a.timeline, { assets: a.assets, style: getStyle(a.timeline.style), aspect: a.aspect });
      return { files: p.files, assetPaths: Object.fromEntries(Object.entries(p.assetPaths).map(([k, v]) => [k, v.uri])), derived: p.derived };
    },
  },
  {
    name: "qa_report",
    title: "QA report",
    description: "Deterministic QA: hook on frame 0, pacing, uncited facts, licenses, placeholders, caption coverage, platform duration limits, loudness.",
    input: z.object({ jobId: z.string() }),
    annotations: { readOnlyHint: true },
    run: async (a: { jobId: string }, ctx) => {
      const base = jobBase(ctx, a.jobId);
      const m = await getJson<JobManifest>(ctx.storage, `${base}manifest.json`);
      const [script, storyboard, timeline, dossier, render] = await Promise.all(["script", "storyboard", "timeline", "research", "render"].map((s) => getJson<unknown>(ctx.storage, `${base}stages/${s}.json`)));
      if (!m || !script || !storyboard || !timeline) throw new Error("job has no composed timeline yet");
      const snd = await getJson<{ timeline: z.infer<typeof Timeline> }>(ctx.storage, `${base}stages/sound.json`);
      const r = render as { lufs?: number; truePeak?: number; durationSec?: number } | null;
      return runQa({ script: script as never, storyboard: storyboard as never, timeline: snd?.timeline ?? (timeline as never), dossier: (dossier ?? undefined) as never, assets: m.assets, platforms: m.brief.platforms, requireSources: m.brief.requireSources, licensedOnly: m.brief.licensedOnly, measured: r ? { lufs: r.lufs, truePeak: r.truePeak, durationSec: r.durationSec } : undefined });
    },
  },
  {
    name: "publish_job",
    title: "Publish a rendered job",
    description: "Upload the rendered video to platforms (YouTube/Shorts, TikTok, Instagram Reels, Facebook Reels, X, LinkedIn, Threads, Pinterest, Bluesky) with per-platform copy.",
    input: z.object({ jobId: z.string(), platforms: z.array(Platform).optional(), copy: PublishCopy.optional() }),
    annotations: { destructiveHint: true, openWorldHint: true },
    run: async (a: { jobId: string; platforms?: z.infer<typeof Platform>[]; copy?: z.infer<typeof PublishCopy> }, ctx) => {
      if (!ctx.publish) throw new Error("publishing is not configured on this host");
      const base = jobBase(ctx, a.jobId);
      const m = await getJson<JobManifest>(ctx.storage, `${base}manifest.json`);
      if (!m?.outputs.videoKey) throw new Error("job has no rendered video");
      const copy = a.copy ?? (await getJson<z.infer<typeof PublishCopy>>(ctx.storage, `${base}stages/copy.json`));
      if (!copy) throw new Error("no publishing copy: pass `copy` or run the copy stage");
      const results = [];
      for (const platform of a.platforms ?? m.brief.platforms) {
        const r = await ctx.publish({ platform, videoKey: m.outputs.videoKey, captionsKey: m.outputs.captionsKey, copy, brief: m.brief, storage: ctx.storage });
        results.push({ platform, ...r });
      }
      m.publications = results.map((r) => ({ platform: r.platform, status: r.status === "skipped" ? "skipped" : r.status, remoteId: r.remoteId, url: r.url, error: r.error }));
      await putJson(ctx.storage, `${base}manifest.json`, m);
      return results;
    },
  },
  {
    name: "adapt_copy",
    title: "Adapt copy per platform",
    description: "Pure: fit a title/description/hashtags to each platform's limits and formatting rules (X weighted length, LinkedIn escaping, Bluesky graphemes…).",
    input: z.object({ copy: PublishCopy, platforms: z.array(Platform) }),
    annotations: { readOnlyHint: true },
    run: async (a: { copy: z.infer<typeof PublishCopy>; platforms: z.infer<typeof Platform>[] }) => Object.fromEntries(a.platforms.map((p) => [p, adaptCopy(p, a.copy)])),
  },
  {
    name: "audit_video",
    title: "Deep-audit a reference video",
    description: "Frame/scene/color/motion/audio/voice analysis of a reference video (needs a Node render node with ffmpeg).",
    input: z.object({ url: z.string().optional(), key: z.string().optional(), transcribe: z.boolean().default(true) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (a: { url?: string; key?: string; transcribe: boolean }, ctx) => {
      if (!ctx.audit) throw new Error("audit needs a Node host with ffmpeg (CLI `vidsk audit` or the render container)");
      return ctx.audit(a);
    },
  },
  {
    name: "describe_setup",
    title: "Describe configuration",
    description: "Configured providers, styles, platforms and known provider limits/workarounds. Call first to know what's available.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: async (_a: Record<string, never>, ctx) => {
      let providers: unknown;
      try {
        providers = describeProviders(ctx.providers());
      } catch (e) {
        providers = { error: e instanceof Error ? e.message : String(e) };
      }
      return { providers, styles: listStyles(), platforms: allPlatformSpecs().map((p) => ({ id: p.id, label: p.label, maxSec: p.maxSec, notes: p.notes })), publishing: !!ctx.publish, backgroundJobs: !!ctx.startJob, limits: PROVIDER_LIMITS.map((l) => ({ id: l.id, kind: l.kind, limits: l.limits })) };
    },
  },
];

function stageCtx(ctx: McpContext) {
  const jobId = newId("adhoc");
  return { providers: ctx.providers(), storage: ctx.storage, logger: silentLogger, jobId, base: `${ctx.prefix ?? "jobs/"}${jobId}/`, concurrency: 4 };
}

/* ------------------------------ resources ------------------------------ */

function resources(): { uri: string; name: string; title: string; mimeType: string; text: () => string }[] {
  const out = Object.entries(DOCS).map(([k, v]) => ({ uri: `vidsk://docs/${k}`, name: k, title: k.replace(/[/-]/g, " "), mimeType: "text/markdown", text: () => v }));
  out.push({ uri: "vidsk://schemas", name: "schemas", title: "JSON Schemas for every contract", mimeType: "application/json", text: () => JSON.stringify(jsonSchemas(), null, 1) });
  out.push({ uri: "vidsk://styles", name: "styles", title: "Style packs", mimeType: "application/json", text: () => JSON.stringify(listStyles().map((s) => ({ ...s, palette: getStyle(s.id).palette, layout9x16: getStyle(s.id).layout("9:16") })), null, 1) });
  out.push({ uri: "vidsk://platforms", name: "platforms", title: "Platform delivery specs", mimeType: "application/json", text: () => JSON.stringify(allPlatformSpecs(), null, 1) });
  out.push({ uri: "vidsk://providers/limits", name: "provider-limits", title: "Provider limits and workarounds", mimeType: "application/json", text: () => JSON.stringify(PROVIDER_LIMITS, null, 1) });
  return out;
}

const PROMPTS = [
  {
    name: "make_explainer_video",
    title: "Make a framed explainer video",
    description: "Guides the model through research → script → storyboard → render → publish using the vid-skills tools.",
    arguments: [
      { name: "topic", description: "What the video is about", required: true },
      { name: "platforms", description: "Comma-separated platforms (youtube_shorts,tiktok,instagram_reels,…)", required: false },
    ],
    build: (a: Record<string, string>) =>
      `Make a ~60–90 s vertical "framed explainer" video about: ${a.topic}.\n\n1. Call describe_setup.\n2. Call make_video with brief {topic, platforms: [${(a.platforms ?? "youtube_shorts,tiktok,instagram_reels").split(",").map((p) => JSON.stringify(p.trim())).join(", ")}]} and stopAfter "compose" so you can review.\n3. Poll job_status. Read compositions with get_project_file; fix anything off-brand with put_project_file.\n4. Call render_job, then qa_report. Fix blockers.\n5. Only if QA passes and the user wants it: publish_job.\nFollow vidsk://docs/skills/explainer-video for the format rules.`,
  },
  {
    name: "audit_reference_video",
    title: "Audit a reference video",
    description: "Deconstruct a reference video into a reusable style pack and script formula.",
    arguments: [{ name: "url", description: "Video URL or storage key", required: true }],
    build: (a: Record<string, string>) => `Call audit_video with url ${JSON.stringify(a.url)}. Then summarise: layout bands, palette, typography, shot-length distribution, transitions, motion vocabulary, VO pacing (wpm, pitch), music/SFX levels and drops, and the script formula. Map each finding to a StylePack field (vidsk://styles) and list what to improve. See vidsk://docs/skills/video-audit.`,
  },
];

/* ------------------------------ JSON-RPC ------------------------------ */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const toolJson = (t: Tool) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }),
  ...(t.annotations ? { annotations: t.annotations } : {}),
});

export class VidSkillsMcp {
  constructor(private readonly ctx: McpContext) {}

  listTools() {
    return TOOLS.map(toolJson);
  }

  async callTool(name: string, args: unknown): Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean }> {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid arguments:\n${parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}` }], isError: true };
    try {
      const out = await tool.run(parsed.data as never, this.ctx);
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return { content: [{ type: "text", text: text.length > 200_000 ? `${text.slice(0, 200_000)}\n…[truncated]` : text }], ...(out && typeof out === "object" && !Array.isArray(out) ? { structuredContent: out } : {}) };
    } catch (e) {
      return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  }

  async handle(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
    const err = (code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (req.id === undefined || req.method.startsWith("notifications/")) return null;
    try {
      switch (req.method) {
        case "initialize": {
          const asked = String(req.params?.protocolVersion ?? "");
          return ok({
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: "vid-skills makes framed short-form explainer videos (HyperFrames) hands-free. Start with describe_setup, then make_video (stopAfter 'compose' to review), job_status, render_job, qa_report, publish_job. Resources hold the reference audit, style packs, schemas and provider limits.",
          });
        }
        case "ping":
          return ok({});
        case "tools/list":
          return ok({ tools: this.listTools() });
        case "tools/call":
          return ok(await this.callTool(String(req.params?.name ?? ""), req.params?.arguments));
        case "resources/list":
          return ok({ resources: resources().map(({ text: _t, ...r }) => r) });
        case "resources/templates/list":
          return ok({ resourceTemplates: [{ uriTemplate: "vidsk://jobs/{jobId}/manifest", name: "job-manifest", mimeType: "application/json" }] });
        case "resources/read": {
          const uri = String(req.params?.uri ?? "");
          const m = /^vidsk:\/\/jobs\/([^/]+)\/manifest$/.exec(uri);
          if (m) {
            const man = await getJson(this.ctx.storage, `${jobBase(this.ctx, m[1]!)}manifest.json`);
            if (!man) return err(-32002, `resource not found: ${uri}`);
            return ok({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(man, null, 1) }] });
          }
          const r = resources().find((x) => x.uri === uri);
          if (!r) return err(-32002, `resource not found: ${uri}`);
          return ok({ contents: [{ uri, mimeType: r.mimeType, text: r.text() }] });
        }
        case "prompts/list":
          return ok({ prompts: PROMPTS.map(({ build: _b, ...p }) => p) });
        case "prompts/get": {
          const p = PROMPTS.find((x) => x.name === req.params?.name);
          if (!p) return err(-32602, "unknown prompt");
          const args = (req.params?.arguments ?? {}) as Record<string, string>;
          return ok({ description: p.description, messages: [{ role: "user", content: { type: "text", text: p.build(args) } }] });
        }
        case "logging/setLevel":
          return ok({});
        default:
          return err(-32601, `method not found: ${req.method}`);
      }
    } catch (e) {
      return err(-32603, e instanceof Error ? e.message : String(e));
    }
  }

  /** Handle one message or a batch. */
  async handleMessage(msg: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map((m) => this.handle(m as JsonRpcRequest)))).filter((x): x is JsonRpcResponse => !!x);
      return out.length ? out : null;
    }
    if (!msg || typeof msg !== "object" || (msg as JsonRpcRequest).jsonrpc !== "2.0") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
    return this.handle(msg as JsonRpcRequest);
  }
}
