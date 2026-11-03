/**
 * vid-skills on Cloudflare.
 *
 *   POST /mcp                       MCP (Streamable HTTP, stateless) for any MCP client
 *   POST /api/tools/<name>          the same tools as plain REST (OpenAPI at /openapi.json)
 *   POST /api/jobs                  { brief, publish? } → starts a durable Workflow run
 *   GET  /api/jobs/<id>             manifest + Workflow status
 *   POST /api/topics                { topics: [...] } → queue topics for scheduled runs
 *   GET  /oauth/<platform>/start    connect a social account (tokens → encrypted KV)
 *   GET  /files/<key>?exp&sig       signed media URLs (R2, Range support)
 *   cron                            hands-free: next queued topic → video → publish
 */
import { Container, getContainer } from "@cloudflare/containers";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getJson, newId, runPipeline, STAGE_ORDER, type JobManifest, type ProviderSet, type StageName, type VideoBriefInput } from "@vid-skills/core";
import { HttpRenderBackend, KokoroTTS, providersFromEnv, type Env as VarEnv } from "@vid-skills/providers";
import { authorizeUrl, createPublisher, exchangeCode, KVTokenStore, OAUTH, publishersFromEnv } from "@vid-skills/distribute";
import { handleMcpHttp, openApiSpec, VidSkillsMcp } from "@vid-skills/mcp";
import { R2Storage, serveSigned } from "./r2-storage.js";

export interface Env {
  AI: Ai;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  PIPELINE: Workflow;
  RENDER_CONTAINER: DurableObjectNamespace<RenderContainer>;
  /** Bearer token for /mcp and /api (wrangler secret put VIDSK_API_TOKEN) */
  VIDSK_API_TOKEN?: string;
  /** HMAC key for signed /files URLs and token encryption (wrangler secret put VIDSK_SECRET) */
  VIDSK_SECRET?: string;
  /** Public origin of this Worker, e.g. https://vid-skills.example.workers.dev */
  VIDSK_ORIGIN?: string;
  RENDER_TOKEN?: string;
  [k: string]: unknown;
}

/** HyperFrames renderer + local Kokoro TTS, built from the repo-root Dockerfile. */
export class RenderContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = true;
  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = { RENDER_TOKEN: env.RENDER_TOKEN ?? "", PRODUCER_LOW_MEMORY_MODE: "false", MAX_CONCURRENT_RENDERS: "1" };
  }
}

function vars(env: Env): VarEnv {
  const out: VarEnv = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  return out;
}

function storageFor(env: Env, origin?: string) {
  return new R2Storage(env.MEDIA, { origin: env.VIDSK_ORIGIN ?? origin, secret: env.VIDSK_SECRET });
}

function providersFor(env: Env, storage: R2Storage): ProviderSet {
  // Shard renders across container instances by job to use max_instances concurrently.
  const container = getContainer(env.RENDER_CONTAINER, "renderer");
  const v = vars(env);
  const overrides: Partial<ProviderSet> = {
    render: new HttpRenderBackend({ url: "http://container", fetcher: container, token: env.RENDER_TOKEN, assetUrl: async (k) => (await storage.publicUrl(k, 3 * 3600))! }),
  };
  // Kokoro without an external server: use the container's OpenAI-compatible /v1/audio/speech.
  if ((v.VIDSK_TTS ?? "").startsWith("kokoro") && !v.KOKORO_BASE_URL) overrides.tts = new KokoroTTS({ baseUrl: "http://container", voice: v.VIDSK_TTS?.split(":")[1] ?? "am_michael", fetcher: container });
  return providersFromEnv(v, { ai: env.AI, overrides });
}

async function publisherFor(env: Env) {
  const store = new KVTokenStore(env.KV, env.VIDSK_SECRET);
  const known = new Set<string>();
  for (const p of ["youtube", "tiktok", "instagram", "facebook", "threads", "x", "linkedin", "pinterest"]) if (await store.get(p)) known.add(p);
  const { publishers, webhook, ready } = publishersFromEnv(vars(env), store, known);
  return createPublisher({ publishers, webhook, ready });
}

function mcp(env: Env, origin: string) {
  const storage = storageFor(env, origin);
  let providers: ProviderSet | undefined;
  return new VidSkillsMcp({
    providers: () => (providers ??= providersFor(env, storage)),
    storage,
    publish: undefined, // set lazily below (needs async KV reads)
    startJob: async ({ jobId, brief, stopAfter, publish }) => {
      await env.PIPELINE.create({ id: jobId, params: { brief, stopAfter, publish } });
    },
    urlFor: (k) => storage.publicUrl(k),
  });
}

const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "cache-control": "no-store" } });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = url.origin;
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname.startsWith("/files/")) return serveSigned(req, env.MEDIA, env.VIDSK_SECRET);
    if (url.pathname === "/openapi.json") return json(openApiSpec(origin));

    if (url.pathname.startsWith("/oauth/")) return oauth(req, env, url);

    const authed = !env.VIDSK_API_TOKEN || req.headers.get("authorization") === `Bearer ${env.VIDSK_API_TOKEN}`;
    if (url.pathname === "/mcp") {
      const server = mcp(env, origin);
      (server as unknown as { ctx: { publish?: unknown } }).ctx.publish = await publisherFor(env);
      return handleMcpHttp(req, server, { token: env.VIDSK_API_TOKEN });
    }
    if (!authed) return json({ error: "unauthorized" }, 401);

    if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
      const server = mcp(env, origin);
      (server as unknown as { ctx: { publish?: unknown } }).ctx.publish = await publisherFor(env);
      const r = await server.callTool(url.pathname.slice("/api/tools/".length), await req.json().catch(() => ({})));
      return json(r.structuredContent ?? { result: r.content[0]?.text }, r.isError ? 400 : 200);
    }
    if (url.pathname === "/api/jobs" && req.method === "POST") {
      const b = (await req.json()) as { brief: VideoBriefInput; publish?: boolean; stopAfter?: StageName };
      const id = newId("job");
      await env.PIPELINE.create({ id, params: { brief: b.brief, publish: !!b.publish, stopAfter: b.stopAfter } });
      return json({ jobId: id, status: "queued" }, 202);
    }
    const jm = /^\/api\/jobs\/([\w-]+)$/.exec(url.pathname);
    if (jm && req.method === "GET") {
      const storage = storageFor(env, origin);
      const manifest = await getJson<JobManifest>(storage, `jobs/${jm[1]}/manifest.json`);
      let workflow: unknown;
      try {
        workflow = await (await env.PIPELINE.get(jm[1]!)).status();
      } catch {
        workflow = null;
      }
      return manifest || workflow ? json({ manifest, workflow, videoUrl: manifest?.outputs.videoKey ? await storage.publicUrl(manifest.outputs.videoKey) : undefined }) : json({ error: "not found" }, 404);
    }
    if (url.pathname === "/api/topics" && req.method === "POST") {
      const b = (await req.json()) as { topics: (string | VideoBriefInput)[] };
      const q = ((await env.KV.get("topics:queue", "json")) as unknown[] | null) ?? [];
      q.push(...b.topics);
      await env.KV.put("topics:queue", JSON.stringify(q));
      return json({ queued: q.length });
    }
    void ctx;
    return new Response("vid-skills: POST /mcp · POST /api/tools/<name> · POST /api/jobs · GET /openapi.json", { status: 404 });
  },

  /** Hands-free mode: one queued topic per tick → full pipeline → publish (per VIDSK_PUBLISH_WHEN). */
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    const q = ((await env.KV.get("topics:queue", "json")) as (string | VideoBriefInput)[] | null) ?? [];
    const next = q.shift();
    if (!next) return;
    await env.KV.put("topics:queue", JSON.stringify(q));
    const v = vars(env);
    const brief: VideoBriefInput = typeof next === "string" ? { topic: next } : next;
    brief.platforms ??= (v.VIDSK_SCHEDULE_PLATFORMS ?? "youtube_shorts,tiktok,instagram_reels").split(",") as never;
    if (v.VIDSK_HANDLE) brief.handle ??= v.VIDSK_HANDLE;
    await env.PIPELINE.create({ id: newId("job"), params: { brief, publish: v.VIDSK_PUBLISH_WHEN !== "never" } });
  },
} satisfies ExportedHandler<Env>;

async function oauth(req: Request, env: Env, url: URL): Promise<Response> {
  const [, , platform, action] = url.pathname.split("/") as [string, string, keyof typeof OAUTH, string];
  if (!OAUTH[platform]) return new Response("unknown platform", { status: 404 });
  const v = vars(env);
  const idVar = platform === "tiktok" ? "TIKTOK_CLIENT_KEY" : platform === "meta" ? "META_APP_ID" : `${platform.toUpperCase()}_CLIENT_ID`;
  const secretVar = platform === "meta" ? "META_APP_SECRET" : `${platform.toUpperCase()}_CLIENT_SECRET`;
  const app = { clientId: v[idVar] ?? "", clientSecret: v[secretVar], redirectUri: `${url.origin}/oauth/${platform}/callback` };
  if (!app.clientId) return new Response(`set ${idVar} / ${secretVar} secrets first`, { status: 400 });
  const store = new KVTokenStore(env.KV, env.VIDSK_SECRET);
  if (action === "start") {
    if (env.VIDSK_API_TOKEN && url.searchParams.get("token") !== env.VIDSK_API_TOKEN) return new Response("pass ?token=<VIDSK_API_TOKEN>", { status: 401 });
    const state = newId("st");
    const { url: to, verifier } = await authorizeUrl(platform, app, state);
    await env.KV.put(`oauth:${state}`, JSON.stringify({ platform, verifier }), { expirationTtl: 900 });
    return Response.redirect(to, 302);
  }
  if (action === "callback") {
    const state = url.searchParams.get("state") ?? "";
    const saved = (await env.KV.get(`oauth:${state}`, "json")) as { platform: string; verifier?: string } | null;
    if (!saved || saved.platform !== platform) return new Response("invalid state", { status: 400 });
    const tokens = await exchangeCode(platform, app, url.searchParams.get("code") ?? "", saved.verifier);
    await store.set(platform === "meta" ? "instagram" : platform, tokens);
    if (platform === "meta") await store.set("facebook", tokens);
    await env.KV.delete(`oauth:${state}`);
    return new Response(`vid-skills: ${platform} connected. You can close this tab.`);
  }
  void req;
  return new Response("not found", { status: 404 });
}

/**
 * Durable pipeline: one Workflow step per stage. Each step re-enters runPipeline
 * with stopAfter=<stage>; completed stages are read back from R2 checkpoints,
 * so a step only does its own work and retries are idempotent.
 */
export class PipelineWorkflow extends WorkflowEntrypoint<Env, { brief: VideoBriefInput; publish: boolean; stopAfter?: StageName }> {
  override async run(event: WorkflowEvent<{ brief: VideoBriefInput; publish: boolean; stopAfter?: StageName }>, step: WorkflowStep) {
    const { brief, publish, stopAfter } = event.payload;
    const jobId = event.instanceId;
    const last = stopAfter ? STAGE_ORDER.indexOf(stopAfter) : STAGE_ORDER.length - 1;
    for (const stage of STAGE_ORDER.slice(0, last + 1)) {
      if (stage === "publish" && !publish) break;
      const heavy = stage === "render" || stage === "assets" || stage === "voice";
      await step.do(
        `stage:${stage}`,
        { retries: { limit: heavy ? 2 : 4, delay: "20 seconds", backoff: "exponential" }, timeout: stage === "render" ? "50 minutes" : "15 minutes" },
        async () => {
          const storage = storageFor(this.env);
          const res = await runPipeline(brief, {
            providers: providersFor(this.env, storage),
            storage,
            jobId,
            stopAfter: stage,
            publish: stage === "publish" ? await publisherFor(this.env) : undefined,
            publishWhen: (vars(this.env).VIDSK_PUBLISH_WHEN as "qa-pass" | "always" | "never") ?? "qa-pass",
          });
          return { stage, status: res.manifest.stages[stage]?.status ?? "skipped" };
        },
      );
    }
    return { jobId };
  }
}
