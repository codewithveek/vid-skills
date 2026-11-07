/**
 * Local render backend: materialize a HyperFrames project on disk, lint it, render
 * it with the HyperFrames CLI (headless Chrome + FFmpeg), master the audio and
 * store the MP4.
 */
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { bytesFromBase64, DEFAULT_GSAP, keyFromUri, type Asset, type HyperFramesProject, type RenderBackend, type RenderRequest, type RenderResult, type Storage } from "@vid-skills/core";
import { exec, execOk } from "./exec.js";
import { masterAudio, probe } from "./ffmpeg.js";

const require = createRequire(import.meta.url);

/** Resolve the hyperframes CLI shipped as a dependency (falls back to npx). */
export function hyperframesBin(): { cmd: string; pre: string[] } {
  if (process.env.HYPERFRAMES_BIN) return { cmd: process.env.HYPERFRAMES_BIN, pre: [] };
  try {
    const pkg = require.resolve("hyperframes/package.json");
    const json = require("hyperframes/package.json") as { bin?: string | Record<string, string> };
    const rel = typeof json.bin === "string" ? json.bin : (json.bin?.hyperframes ?? "bin/hyperframes.mjs");
    return { cmd: process.execPath, pre: [join(dirname(pkg), rel)] };
  } catch {
    return { cmd: "npx", pre: ["--yes", "hyperframes@0.8.211"] };
  }
}

function safeJoin(root: string, rel: string): string {
  const p = resolve(root, rel);
  if (!p.startsWith(resolve(root) + sep)) throw new Error(`path escapes project: ${rel}`);
  return p;
}

async function bytesForUri(uri: string, storage?: Storage): Promise<Uint8Array> {
  const key = keyFromUri(uri);
  if (key) {
    if (!storage) throw new Error(`no storage for ${uri}`);
    const b = await storage.get(key);
    if (!b) throw new Error(`missing in storage: ${key}`);
    return b;
  }
  if (uri.startsWith("data:")) {
    const [, meta, data] = /^data:([^,]*),(.*)$/s.exec(uri) ?? [];
    return meta?.includes("base64") ? bytesFromBase64(data ?? "") : new TextEncoder().encode(decodeURIComponent(data ?? ""));
  }
  if (uri.startsWith("file://")) return new Uint8Array(await readFile(uri.slice(7)));
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`fetch ${res.status} ${uri}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Cache GSAP locally so renders don't depend on a CDN at frame-capture time. */
export async function vendorGsap(projectDir: string, indexHtml: string): Promise<string> {
  const cacheDir = join(process.env.VIDSK_CACHE ?? join(homedir(), ".cache", "vidsk"));
  const cached = join(cacheDir, "gsap-3.14.2.min.js");
  try {
    await stat(cached);
  } catch {
    try {
      const r = await fetch(DEFAULT_GSAP);
      if (!r.ok) return indexHtml;
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cached, new Uint8Array(await r.arrayBuffer()));
    } catch {
      return indexHtml;
    }
  }
  await mkdir(join(projectDir, "assets/vendor"), { recursive: true });
  await copyFile(cached, join(projectDir, "assets/vendor/gsap.min.js"));
  return indexHtml.replace(DEFAULT_GSAP, "assets/vendor/gsap.min.js");
}

/** Write a project to `dir`, pulling asset bytes from storage/URLs. */
export async function materializeProject(
  p: { files: Record<string, string | Uint8Array>; assetKeys?: Record<string, string>; assetPaths?: Record<string, Asset> },
  dir: string,
  storage?: Storage,
  opts: { vendor?: boolean } = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const [rel, content] of Object.entries(p.files)) {
    const abs = safeJoin(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  const jobs: [string, string][] = [];
  for (const [rel, key] of Object.entries(p.assetKeys ?? {})) jobs.push([rel, `store://${key}`]);
  for (const [rel, a] of Object.entries(p.assetPaths ?? {})) if (!p.assetKeys?.[rel]) jobs.push([rel, a.uri]);
  await Promise.all(
    jobs.map(async ([rel, uri]) => {
      const abs = safeJoin(dir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, await bytesForUri(uri, storage));
    }),
  );
  await buildDerived(dir, typeof p.files["vidsk.derived.json"] === "string" ? p.files["vidsk.derived.json"] : undefined, typeof p.files["vidsk.timeline.json"] === "string" ? p.files["vidsk.timeline.json"] : undefined);
  if (opts.vendor !== false && typeof p.files["index.html"] === "string") {
    const html = await vendorGsap(dir, p.files["index.html"]);
    await writeFile(join(dir, "index.html"), html);
  }
  return dir;
}

/**
 * Generate derived assets declared by the compiler (pre-blurred low-res fills).
 * Falls back to copying the source so a render never breaks on a missing file.
 */
export async function buildDerived(dir: string, derivedJson?: string, timelineJson?: string): Promise<void> {
  if (!derivedJson) return;
  const derived = JSON.parse(derivedJson) as Record<string, { from: string; op: string }>;
  const tl = timelineJson ? (JSON.parse(timelineJson) as { width?: number; height?: number }) : {};
  const w = Math.max(64, Math.round((tl.width ?? 1080) / 6 / 2) * 2);
  const h = Math.max(64, Math.round((tl.height ?? 1920) / 6 / 2) * 2);
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=9,eq=brightness=-0.05:saturation=1.15`;
  await Promise.all(
    Object.entries(derived).map(async ([out, d]) => {
      const src = safeJoin(dir, d.from);
      const dst = safeJoin(dir, out);
      await mkdir(dirname(dst), { recursive: true });
      const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(out);
      const args = isVideo
        ? ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-an", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst]
        : ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "4", dst];
      const r = await exec(process.env.FFMPEG_PATH ?? "ffmpeg", args, { timeoutMs: 10 * 60_000 });
      if (r.code !== 0) await copyFile(src, dst).catch(() => {});
    }),
  );
}

export interface CheckResult {
  ok: boolean;
  errors: unknown[];
  warnings: unknown[];
  raw: string;
}

export async function checkProject(dir: string): Promise<CheckResult> {
  const { cmd, pre } = hyperframesBin();
  const r = await exec(cmd, [...pre, "check", dir, "--json"], { timeoutMs: 5 * 60_000 });
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as Record<string, unknown> & { ok?: boolean };
    // `check --json` groups findings by section (lint, runtime, layout, motion, contrast, craft, audio…).
    const findings: { severity?: string; code?: string; message?: string; section: string }[] = [];
    for (const [section, v] of Object.entries(j)) {
      const f = (v as { findings?: { severity?: string; code?: string; message?: string; text?: string; time?: number; sourceFile?: string }[] } | null)?.findings;
      // Say where: the bare message ("Contrast is 1.75:1") doesn't name the element, time or scene.
      const where = (x: { text?: string; time?: number; sourceFile?: string }) => [x.text ? `"${x.text.slice(0, 40)}"` : "", typeof x.time === "number" ? `at ${x.time.toFixed(2)} s` : "", x.sourceFile ? `in ${x.sourceFile}` : ""].filter(Boolean).join(" ");
      if (Array.isArray(f)) for (const x of f) findings.push({ section, severity: x.severity, code: x.code, message: [x.message, where(x) && `(${where(x)})`].filter(Boolean).join(" ") });
    }
    const errors = findings.filter((f) => f.severity === "error");
    const warnings = findings.filter((f) => f.severity === "warning");
    return { ok: j.ok ?? errors.length === 0, errors, warnings, raw: r.stdout };
  } catch {
    return { ok: r.code === 0, errors: r.code === 0 ? [] : [r.stderr.slice(-2000)], warnings: [], raw: r.stdout + r.stderr };
  }
}

export interface LocalRenderOptions {
  workers?: number | "auto";
  quality?: "draft" | "standard" | "high";
  timeoutMs?: number;
  keepWorkdir?: boolean;
  onLog?: (line: string) => void;
}

export async function renderProjectDir(dir: string, out: string, req: { fps: number; quality: RenderRequest["quality"]; format?: string; master?: { lufs: number; truePeak: number }; signal?: AbortSignal }, o: LocalRenderOptions = {}): Promise<RenderResult> {
  const { cmd, pre } = hyperframesBin();
  const raw = join(dirname(out), `raw-${Date.now()}.${req.format ?? "mp4"}`);
  const args = [...pre, "render", dir, "-o", raw, "--fps", String(req.fps), "--quality", req.quality === "high" ? "high" : req.quality, "--workers", String(o.workers ?? "auto"), "--quiet"];
  const r = await exec(cmd, args, { timeoutMs: o.timeoutMs ?? 45 * 60_000, signal: req.signal, onStderr: o.onLog, env: { PRODUCER_LOW_MEMORY_MODE: process.env.PRODUCER_LOW_MEMORY_MODE ?? "" } });
  if (r.code !== 0) throw new Error(`hyperframes render failed (${r.code}):\n${(r.stderr || r.stdout).slice(-6000)}`);
  let measured: Awaited<ReturnType<typeof masterAudio>> = null;
  if (req.master && (req.format ?? "mp4") === "mp4") {
    measured = await masterAudio(raw, out, req.master);
    await rm(raw, { force: true });
  } else {
    await copyFile(raw, out);
    await rm(raw, { force: true });
  }
  const p = await probe(out);
  return { durationSec: p.durationSec, measuredLufs: measured?.integrated, measuredTruePeak: measured?.truePeak, log: r.stdout.slice(-4000) };
}

/** RenderBackend implementation for Node hosts (CLI, Docker, Cloud Run, Cloudflare Container). */
export class LocalRenderBackend implements RenderBackend {
  readonly id = "local-hyperframes";
  constructor(private readonly o: LocalRenderOptions & { workRoot?: string } = {}) {}
  async render(req: RenderRequest, storage: Storage, outKey: string): Promise<RenderResult> {
    const work = await mkdtemp(join(this.o.workRoot ?? tmpdir(), "vidsk-render-"));
    try {
      const dir = await materializeProject({ files: req.files, assetKeys: req.assetKeys }, join(work, "project"), storage);
      const out = join(work, `out.${req.format ?? "mp4"}`);
      const res = await renderProjectDir(dir, out, req, this.o);
      const bytes = new Uint8Array(await readFile(out));
      await storage.put(outKey, bytes, "video/mp4");
      return { ...res, storageKey: outKey };
    } finally {
      if (!this.o.keepWorkdir) await rm(work, { recursive: true, force: true });
    }
  }
}

/** Convenience: render a compiled project (from `compileHyperFrames`) straight to a file. */
export async function renderProjectToFile(project: HyperFramesProject, storage: Storage | undefined, outFile: string, o: LocalRenderOptions & { projectDir?: string; master?: boolean } = {}): Promise<RenderResult & { projectDir: string }> {
  const dir = o.projectDir ?? (await mkdtemp(join(tmpdir(), "vidsk-project-")));
  await materializeProject({ files: project.files, assetPaths: project.assetPaths }, dir, storage);
  await mkdir(dirname(resolve(outFile)), { recursive: true });
  const res = await renderProjectDir(dir, resolve(outFile), { fps: project.fps, quality: o.quality ?? "standard", master: o.master === false ? undefined : { lufs: -14, truePeak: -1 } }, o);
  return { ...res, projectDir: dir };
}

export { execOk };
