/**
 * vidsk — the command-line front end.
 *
 *   vidsk make "<topic>" [--duration 75] [--platforms youtube_shorts,tiktok] [--stop-after compose] [--publish]
 *   vidsk resume <jobId> [--force script,storyboard] [--publish]
 *   vidsk audit <video.mp4> [--out dir] [--transcribe]
 *   vidsk render <projectDir> [-o out.mp4] [--quality draft|standard|high]
 *   vidsk check <projectDir>
 *   vidsk publish <video.mp4> --platforms x,linkedin --title "…" [--description "…"] | --job <jobId>
 *   vidsk auth <youtube|tiktok|x|linkedin|pinterest|threads|meta>
 *   vidsk mcp                      # MCP over stdio (Claude Desktop/Code, Cursor, Codex, Gemini CLI, Goose…)
 *   vidsk serve [--port 8787]      # MCP Streamable HTTP at /mcp + REST /api/tools/<name> + OpenAPI
 *   vidsk providers | limits | doctor | tools [--format openai|anthropic|gemini|openapi|mcp]
 */
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { consoleLogger, getJson, newId, runPipeline, STAGE_ORDER, type JobManifest, type ProviderSet, type StageName, type VideoBriefInput } from "@vid-skills/core";
import { ConfigError, describeProviders, DryRunTTS, limitsMarkdown, providersFromEnv, type Env } from "@vid-skills/providers";
import { authorizeUrl, bytesSource, createPublisher, exchangeCode, OAUTH, publishersFromEnv, type TokenSet, type TokenStore } from "@vid-skills/distribute";
import { anthropicTools, geminiTools, handleMcpHttp, openAiTools, openApiSpec, serveLines, VidSkillsMcp, TOOLS } from "@vid-skills/mcp";
import { auditVideo, checkProject, FsStorage, LocalKokoroTTS, LocalRenderBackend, LocalWhisperSTT, probe, renderProjectDir, exec, hyperframesBin, thumbnail } from "@vid-skills/renderer";

/* ------------------------------ env & stores ------------------------------ */

function loadDotenv(file = ".env"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = v;
  }
}

const HOME = process.env.VIDSK_HOME ?? join(homedir(), ".vidsk");

class FileTokenStore implements TokenStore {
  constructor(private readonly file = join(HOME, "tokens.json")) {}
  private async all(): Promise<Record<string, TokenSet>> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Record<string, TokenSet>;
    } catch {
      return {};
    }
  }
  async keys(): Promise<Set<string>> {
    return new Set(Object.keys(await this.all()));
  }
  async get(k: string) {
    return (await this.all())[k] ?? null;
  }
  async set(k: string, t: TokenSet) {
    const a = await this.all();
    a[k] = t;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(a, null, 2));
    await chmod(this.file, 0o600);
  }
}

function log(...a: unknown[]) {
  process.stderr.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x, null, 2))).join(" ") + "\n");
}

/** Providers from env plus local fallbacks (Kokoro/whisper via HyperFrames, local renderer). */
function buildProviders(env: Env, opts: { dryRun?: boolean } = {}): ProviderSet {
  const overrides: Partial<ProviderSet> = { render: new LocalRenderBackend({ onLog: process.env.VIDSK_DEBUG ? (s) => process.stderr.write(s) : undefined }) };
  if (opts.dryRun) overrides.tts = new DryRunTTS();
  else if (!env.VIDSK_TTS && !env.ELEVENLABS_API_KEY && !env.KOKORO_BASE_URL && !env.CARTESIA_API_KEY && !env.OPENAI_API_KEY) overrides.tts = new LocalKokoroTTS({ voice: env.KOKORO_VOICE });
  if (!env.VIDSK_STT && !env.GROQ_API_KEY && !env.OPENAI_API_KEY && !env.DEEPGRAM_API_KEY && env.VIDSK_LOCAL_STT !== "0") overrides.stt = new LocalWhisperSTT();
  return providersFromEnv(env, { overrides });
}

async function publisherFor(env: Env, dryRun = false) {
  const store = new FileTokenStore();
  const { publishers, webhook, ready } = publishersFromEnv(env, store, await store.keys());
  return { publish: createPublisher({ publishers, webhook, ready, mode: dryRun ? "dry-run" : "live", onResult: (r) => log(`[publish] ${r.platform}: ${r.status}${r.url ? ` ${r.url}` : ""}${r.error ? ` (${r.error})` : ""}`) }), platforms: [...publishers.keys()] };
}

/* ------------------------------ commands ------------------------------ */

async function cmdMake(args: string[], env: Env) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      duration: { type: "string" },
      platforms: { type: "string" },
      style: { type: "string" },
      aspect: { type: "string" },
      headline: { type: "string" },
      handle: { type: "string" },
      angle: { type: "string" },
      voice: { type: "string" },
      brief: { type: "string" },
      out: { type: "string", default: "./out" },
      "stop-after": { type: "string" },
      publish: { type: "boolean", default: false },
      review: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      job: { type: "string" },
    },
  });
  const fromFile = values.brief ? (JSON.parse(await readFile(values.brief, "utf8")) as VideoBriefInput) : undefined;
  const topic = positionals.join(" ") || fromFile?.topic;
  if (!topic) throw new Error('usage: vidsk make "<topic>" [options]');
  const brief: VideoBriefInput = {
    ...(fromFile ?? {}),
    topic,
    ...(values.duration ? { durationSec: Number(values.duration) } : {}),
    ...(values.platforms ? { platforms: values.platforms.split(",") as never } : {}),
    ...(values.style ? { style: values.style } : {}),
    ...(values.aspect ? { aspect: values.aspect as never } : {}),
    ...(values.headline ? { headline: values.headline } : {}),
    ...(values.handle ? { handle: values.handle } : {}),
    ...(values.angle ? { angle: values.angle } : {}),
    ...(values.voice ? { voice: { voice: values.voice } } : {}),
  };
  const out = resolve(values.out!);
  const storage = new FsStorage(join(out, ".vidsk"));
  const providers = buildProviders(env, { dryRun: values["dry-run"] });
  log("providers:", describeProviders(providers));
  const pub = values.publish ? await publisherFor(env, values["dry-run"]) : undefined;
  const jobId = values.job ?? newId("job");
  log(`job ${jobId} → ${out}`);
  const res = await runPipeline(brief, {
    providers,
    storage,
    jobId,
    logger: consoleLogger,
    stopAfter: values["stop-after"] as StageName | undefined,
    publish: pub?.publish,
    review: values.review,
    onProgress: (s, st, info) => log(`[${s}] ${st}${info?.error ? `: ${String(info.error)}` : ""}`),
  });
  await finish(res.manifest, storage, out);
  if (res.qa) log(`QA: ${res.qa.pass ? "PASS" : "FAIL"} (score ${res.qa.score})`, res.qa.findings.map((f) => `${f.severity} ${f.code}${f.where ? ` @${f.where}` : ""}: ${f.message}`));
}

async function finish(m: JobManifest, storage: FsStorage, out: string) {
  const projectDir = join(out, m.id, "project");
  const files = await storage.list(`jobs/${m.id}/project/`);
  if (files.length) {
    const { materializeProject } = await import("@vid-skills/renderer");
    await rm(projectDir, { recursive: true, force: true }); // drop files a re-compose no longer produces
    const fileMap: Record<string, string> = {};
    for (const f of files) fileMap[f.key.slice(`jobs/${m.id}/project/`.length)] = (await storage.getText(f.key)) ?? "";
    const assets = JSON.parse(fileMap["vidsk.assets.json"] ?? "[]") as { path: string; id: string }[];
    const assetKeys: Record<string, string> = {};
    for (const a of assets) {
      const asset = m.assets.find((x) => x.id === a.id);
      if (asset?.uri.startsWith("store://")) assetKeys[a.path] = asset.uri.slice(8);
    }
    await materializeProject({ files: fileMap, assetKeys }, projectDir, storage);
    log(`HyperFrames project: ${projectDir}  (edit visually: npx hyperframes preview ${projectDir})`);
  }
  if (m.outputs.videoKey) {
    const dst = join(out, `${m.id}.mp4`);
    await copyFile(storage.path(m.outputs.videoKey), dst);
    log(`video: ${dst}`);
    // Frame 0 doubles as the cover image for platforms that take a separate upload.
    const cover = join(out, `${m.id}.cover.jpg`);
    if (await thumbnail(dst, cover, 0).then(() => true, () => false)) log(`cover: ${cover}`);
  }
  const posterCut = m.outputs.variants?.poster?.videoKey;
  if (posterCut) {
    const dst = join(out, `${m.id}.poster.mp4`);
    await copyFile(storage.path(posterCut), dst);
    log(`poster variant: ${dst}`);
  }
  if (m.outputs.captionsKey) await copyFile(storage.path(m.outputs.captionsKey), join(out, `${m.id}.srt`));
  console.log(JSON.stringify({ jobId: m.id, outputs: m.outputs, publications: m.publications }, null, 2));
}

async function cmdResume(args: string[], env: Env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { force: { type: "string" }, out: { type: "string", default: "./out" }, publish: { type: "boolean", default: false }, "stop-after": { type: "string" } } });
  const jobId = positionals[0];
  if (!jobId) throw new Error("usage: vidsk resume <jobId>");
  const out = resolve(values.out!);
  const storage = new FsStorage(join(out, ".vidsk"));
  const m = await getJson<JobManifest>(storage, `jobs/${jobId}/manifest.json`);
  if (!m) throw new Error(`no job ${jobId} under ${out}`);
  const force = (values.force?.split(",").filter(Boolean) ?? []) as StageName[];
  for (const f of force) if (!STAGE_ORDER.includes(f)) throw new Error(`unknown stage ${f}`);
  const pub = values.publish ? await publisherFor(env) : undefined;
  const res = await runPipeline(m.brief, { providers: buildProviders(env), storage, jobId, force, publish: pub?.publish, stopAfter: values["stop-after"] as StageName | undefined, logger: consoleLogger, onProgress: (s, st) => log(`[${s}] ${st}`) });
  await finish(res.manifest, storage, out);
}

async function cmdAudit(args: string[], env: Env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { out: { type: "string" }, transcribe: { type: "boolean", default: false } } });
  const file = positionals[0];
  if (!file) throw new Error("usage: vidsk audit <video> [--out dir] [--transcribe]");
  const outDir = resolve(values.out ?? `${file}.audit`);
  let stt;
  if (values.transcribe) {
    try {
      stt = providersFromEnv({ ...env, VIDSK_TTS: env.VIDSK_TTS ?? "dry-run", VIDSK_LLM: env.VIDSK_LLM ?? "ollama:none" }).stt ?? new LocalWhisperSTT();
    } catch {
      stt = new LocalWhisperSTT();
    }
  }
  const r = await auditVideo(resolve(file), { outDir, stt });
  log(`audit written to ${outDir}/audit.md and audit.json`);
  console.log(await readFile(join(outDir, "audit.md"), "utf8"));
  return r;
}

async function cmdRender(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { output: { type: "string", short: "o" }, quality: { type: "string", default: "high" }, fps: { type: "string", default: "30" }, "no-master": { type: "boolean", default: false } } });
  const dir = positionals[0];
  if (!dir) throw new Error("usage: vidsk render <projectDir> [-o out.mp4]");
  const out = resolve(values.output ?? join(dir, "render.mp4"));
  await mkdir(dirname(out), { recursive: true });
  const r = await renderProjectDir(resolve(dir), out, { fps: Number(values.fps), quality: values.quality as never, master: values["no-master"] ? undefined : { lufs: -14, truePeak: -1 } }, { onLog: (s) => process.stderr.write(s) });
  console.log(JSON.stringify({ output: out, ...r }, null, 2));
}

async function cmdPublish(args: string[], env: Env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { platforms: { type: "string" }, title: { type: "string" }, description: { type: "string" }, hashtags: { type: "string" }, captions: { type: "string" }, job: { type: "string" }, out: { type: "string", default: "./out" }, "dry-run": { type: "boolean", default: false } } });
  const { publish, platforms: configured } = await publisherFor(env, values["dry-run"]);
  const platforms = (values.platforms?.split(",") ?? configured) as never[];
  if (values.job) {
    const storage = new FsStorage(join(resolve(values.out!), ".vidsk"));
    const m = await getJson<JobManifest>(storage, `jobs/${values.job}/manifest.json`);
    const copy = await getJson<never>(storage, `jobs/${values.job}/stages/copy.json`);
    if (!m?.outputs.videoKey || !copy) throw new Error("job has no rendered video/copy");
    for (const p of platforms) await publish({ platform: p, videoKey: m.outputs.videoKey, captionsKey: m.outputs.captionsKey, copy, brief: m.brief, storage });
    return;
  }
  const file = positionals[0];
  if (!file || !values.title) throw new Error('usage: vidsk publish <video.mp4> --title "…" [--description "…"] [--platforms a,b]');
  const storage = new FsStorage(dirname(resolve(file)));
  const key = resolve(file).slice(storage.root.length + 1);
  const copy = { title: values.title, description: values.description ?? values.title, hashtags: values.hashtags?.split(",") ?? [], keywords: [], sources: [] };
  const pr = await probe(resolve(file));
  for (const p of platforms) await publish({ platform: p, videoKey: key, captionsKey: values.captions ? resolve(values.captions).slice(storage.root.length + 1) : undefined, copy, brief: { topic: values.title, durationSec: Math.ceil(pr.durationSec) } as never, storage });
  void bytesSource;
}

async function cmdAuth(args: string[], env: Env) {
  const platform = args[0] as keyof typeof OAUTH | undefined;
  if (!platform || !OAUTH[platform]) throw new Error(`usage: vidsk auth <${Object.keys(OAUTH).join("|")}>`);
  const prefix = platform === "meta" ? "META_APP" : platform === "tiktok" ? "TIKTOK_CLIENT" : `${platform.toUpperCase()}_CLIENT`;
  const clientId = env[platform === "tiktok" ? "TIKTOK_CLIENT_KEY" : platform === "meta" ? "META_APP_ID" : `${prefix}_ID`];
  const clientSecret = env[platform === "meta" ? "META_APP_SECRET" : `${prefix}_SECRET`];
  if (!clientId) throw new Error(`set ${platform === "tiktok" ? "TIKTOK_CLIENT_KEY" : platform === "meta" ? "META_APP_ID" : `${prefix}_ID`} (and the secret) first; see docs/distribution.md`);
  const port = Number(env.VIDSK_AUTH_PORT ?? 8789);
  const redirectUri = env.VIDSK_REDIRECT_URI ?? `http://localhost:${port}/callback`;
  const state = newId("st");
  const { url, verifier } = await authorizeUrl(platform, { clientId, clientSecret, redirectUri }, state);
  log(`Open this URL, approve, and you'll be redirected to ${redirectUri}:\n\n${url}\n`);
  const code = await new Promise<string>((res, rej) => {
    const srv = createServer((req, resp) => {
      const u = new URL(req.url ?? "/", redirectUri);
      if (u.pathname !== new URL(redirectUri).pathname) return void resp.writeHead(404).end();
      if (u.searchParams.get("state") !== state) return void resp.writeHead(400).end("state mismatch");
      resp.end("vid-skills: authorized. You can close this tab.");
      srv.close();
      const c = u.searchParams.get("code");
      c ? res(c) : rej(new Error(u.searchParams.get("error_description") ?? "no code"));
    }).listen(port);
  });
  const tokens = await exchangeCode(platform, { clientId, clientSecret, redirectUri }, code, verifier);
  const store = new FileTokenStore();
  const key = platform === "meta" ? "instagram" : platform;
  await store.set(key, tokens);
  if (platform === "meta") await store.set("facebook", tokens);
  log(`saved ${platform} tokens to ${join(HOME, "tokens.json")} (refresh tokens rotate automatically)`);
}

async function cmdDoctor(env: Env) {
  const checks: [string, boolean, string][] = [];
  const ff = await exec("ffmpeg", ["-version"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  checks.push(["ffmpeg", ff.code === 0, ff.stdout.split("\n")[0] ?? "missing (apt install ffmpeg / brew install ffmpeg)"]);
  const { cmd, pre } = hyperframesBin();
  const hf = await exec(cmd, [...pre, "--version"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  checks.push(["hyperframes", hf.code === 0, hf.stdout.trim() || "missing"]);
  const doc = await exec(cmd, [...pre, "doctor"]).catch(() => ({ code: 1, stdout: "", stderr: "" }));
  checks.push(["chrome", /Chrome\s+.*✓|✓ Chrome/.test(doc.stdout) || !/✗ Chrome/.test(doc.stdout), /✗ Chrome/.test(doc.stdout) ? "run: npx hyperframes browser ensure" : "ok"]);
  try {
    checks.push(["providers", true, JSON.stringify(describeProviders(buildProviders(env)))]);
  } catch (e) {
    checks.push(["providers", false, e instanceof ConfigError ? e.message : String(e)]);
  }
  const { platforms } = await publisherFor(env);
  checks.push(["publishing", platforms.length > 0, platforms.join(", ") || "no platform credentials (optional)"]);
  for (const [n, ok, info] of checks) console.log(`${ok ? "✓" : "✗"} ${n.padEnd(12)} ${info}`);
}

function mcpServer(env: Env, out = "./out", pub?: Awaited<ReturnType<typeof publisherFor>>) {
  const storage = new FsStorage(join(resolve(out), ".vidsk"));
  let cached: ProviderSet | undefined;
  return new VidSkillsMcp({
    providers: () => (cached ??= buildProviders(env)),
    storage,
    publish: pub?.publish,
    audit: async (a) => {
      if (!a.url && !a.key) throw new Error("url or key required");
      let file = a.key ? storage.path(a.key) : a.url!;
      if (a.url?.startsWith("http")) {
        const dl = join(storage.root, "downloads", `${newId("ref")}.mp4`);
        await mkdir(dirname(dl), { recursive: true });
        await writeFile(dl, new Uint8Array(await (await fetch(a.url)).arrayBuffer()));
        file = dl;
      }
      return auditVideo(file, { outDir: `${file}.audit`, images: true, stt: a.transcribe ? new LocalWhisperSTT() : undefined });
    },
    urlFor: async (k) => `file://${storage.path(k)}`,
  });
}

async function cmdMcp(env: Env) {
  // stdout is the protocol channel: everything else goes to stderr.
  console.log = (...a: unknown[]) => log(...a);
  const server = mcpServer(env, env.VIDSK_OUT ?? "./out", await publisherFor(env));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  await serveLines(rl, (s) => process.stdout.write(s), server);
}

async function cmdServe(args: string[], env: Env) {
  const { values } = parseArgs({ args, options: { port: { type: "string", default: env.PORT ?? "8787" }, out: { type: "string", default: "./out" } } });
  const server = mcpServer(env, values.out, await publisherFor(env));
  const token = env.VIDSK_API_TOKEN;
  createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    let response: Response;
    if (url.pathname === "/mcp") response = await handleMcpHttp(request, server, { token, allowedOrigins: env.VIDSK_ALLOWED_ORIGINS?.split(",") });
    else if (url.pathname === "/openapi.json") response = Response.json(openApiSpec(`http://${req.headers.host}`));
    else if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
      if (token && req.headers.authorization !== `Bearer ${token}`) response = new Response("unauthorized", { status: 401 });
      else {
        const r = await server.callTool(url.pathname.slice("/api/tools/".length), chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
        response = Response.json(r.structuredContent ?? { result: r.content[0]?.text }, { status: r.isError ? 400 : 200 });
      }
    } else if (url.pathname === "/healthz") response = new Response("ok");
    else response = new Response("vid-skills: POST /mcp (MCP), POST /api/tools/<name>, GET /openapi.json", { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  }).listen(Number(values.port), () => log(`vid-skills listening on http://localhost:${values.port}  (MCP: /mcp, REST: /api/tools/<name>, OpenAPI: /openapi.json)`));
}

function cmdTools(args: string[]) {
  const { values } = parseArgs({ args, options: { format: { type: "string", default: "mcp" } } });
  const f = values.format;
  const out = f === "openai" ? openAiTools() : f === "anthropic" ? anthropicTools() : f === "gemini" ? geminiTools() : f === "openapi" ? openApiSpec() : TOOLS.map((t) => ({ name: t.name, description: t.description }));
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  loadDotenv();
  const env = process.env as Env;
  // `VIDSK_LLM=static:<answers.json>`: load replay answers from a file (examples/replay/*.json).
  const st = /^static:(.+)$/.exec(env.VIDSK_LLM ?? "");
  if (st && existsSync(st[1]!)) {
    env.VIDSK_STATIC_ANSWERS = readFileSync(st[1]!, "utf8");
    env.VIDSK_LLM = "static";
  }
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "make":
      return cmdMake(rest, env);
    case "resume":
      return cmdResume(rest, env);
    case "audit":
      return cmdAudit(rest, env);
    case "render":
      return cmdRender(rest);
    case "check": {
      const r = await checkProject(resolve(rest[0] ?? "."));
      console.log(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings }, null, 2));
      process.exitCode = r.ok ? 0 : 1;
      return;
    }
    case "publish":
      return cmdPublish(rest, env);
    case "auth":
      return cmdAuth(rest, env);
    case "mcp":
      return cmdMcp(env);
    case "serve":
      return cmdServe(rest, env);
    case "providers":
      console.log(JSON.stringify(describeProviders(buildProviders(env)), null, 2));
      return;
    case "limits":
      console.log(limitsMarkdown());
      return;
    case "tools":
      return cmdTools(rest);
    case "doctor":
      return cmdDoctor(env);
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]!.replace(/^\/\*\*?|^ \* ?/gm, "").trim());
  }
}

main().catch((e: unknown) => {
  log(`error: ${e instanceof Error ? e.message : String(e)}`);
  if (process.env.VIDSK_DEBUG && e instanceof Error) log(e.stack ?? "");
  process.exit(1);
});
