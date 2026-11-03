#!/usr/bin/env node
/**
 * Render node HTTP server (Cloudflare Container, Docker, Cloud Run, Fly, k8s).
 *
 *   GET  /healthz
 *   POST /render              multipart: manifest (JSON) + file:<path> parts → video/mp4 (x-duration, x-lufs, x-true-peak)
 *   POST /audit               multipart: file (video) [+ transcribe=1] → audit JSON
 *   POST /transcode?platform= body: video/mp4 → platform-fitted video/mp4
 *   POST /v1/audio/speech     OpenAI-compatible Kokoro TTS (lets Workers use open-source TTS in the same container)
 *
 * Auth: `Authorization: Bearer $RENDER_TOKEN` when RENDER_TOKEN is set.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Asset, Platform } from "@vid-skills/core";
import { auditVideo } from "./audit.js";
import { transcodeFor } from "./ffmpeg.js";
import { LocalKokoroTTS, LocalWhisperSTT } from "./local-providers.js";
import { materializeProject, renderProjectDir } from "./render.js";

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.RENDER_TOKEN;
const MAX_BODY = Number(process.env.MAX_BODY_MB ?? 1024) * 2 ** 20;
let active = 0;
const MAX_ACTIVE = Number(process.env.MAX_CONCURRENT_RENDERS ?? 1);

function toRequest(req: IncomingMessage): Request {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 });
  return new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream), duplex: "half" } as RequestInit);
}

async function send(res: ServerResponse, r: Response): Promise<void> {
  res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
  if (r.body) {
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } else res.end();
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") return new Response("ok");
  if (TOKEN && req.headers.get("authorization") !== `Bearer ${TOKEN}`) return new Response("unauthorized", { status: 401 });

  if (req.method === "POST" && url.pathname === "/render") {
    if (active >= MAX_ACTIVE) return new Response("busy", { status: 503, headers: { "retry-after": "30" } });
    active++;
    const work = await mkdtemp(join(tmpdir(), "vidsk-node-"));
    try {
      const fd = await req.formData();
      const manifest = JSON.parse(String(fd.get("manifest") ?? "{}")) as { fps?: number; quality?: "draft" | "standard" | "high"; format?: string; master?: { lufs: number; truePeak: number }; assetUrls?: Record<string, string> };
      const files: Record<string, Uint8Array> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("file:") && typeof v !== "string") files[k.slice(5)] = new Uint8Array(await v.arrayBuffer());
      const textFiles: Record<string, string | Uint8Array> = {};
      for (const [p, b] of Object.entries(files)) textFiles[p] = /\.(html|json|css|js|md|srt|vtt)$/.test(p) ? new TextDecoder().decode(b) : b;
      // Assets may arrive inline (file: parts) or as URLs the node downloads itself.
      const assetPaths = Object.fromEntries(Object.entries(manifest.assetUrls ?? {}).map(([p, uri]) => [p, { id: p, kind: "image", uri, provider: "remote", license: { name: "n/a", commercialUse: true, requiresAttribution: false }, role: "other" } as Asset]));
      const dir = await materializeProject({ files: textFiles, assetPaths }, join(work, "project"));
      const out = join(work, "out.mp4");
      const r = await renderProjectDir(dir, out, { fps: manifest.fps ?? 30, quality: manifest.quality ?? "high", format: manifest.format, master: manifest.master, signal: req.signal });
      const bytes = await readFile(out);
      return new Response(bytes, { headers: { "content-type": "video/mp4", "x-duration": String(r.durationSec ?? ""), "x-lufs": String(r.measuredLufs ?? ""), "x-true-peak": String(r.measuredTruePeak ?? "") } });
    } finally {
      active--;
      await rm(work, { recursive: true, force: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/audit") {
    const work = await mkdtemp(join(tmpdir(), "vidsk-audit-"));
    try {
      const fd = await req.formData();
      const f = fd.get("file");
      if (!f || typeof f === "string") return new Response("file required", { status: 400 });
      const input = join(work, "input.mp4");
      await writeFile(input, new Uint8Array(await f.arrayBuffer()));
      const report = await auditVideo(input, { outDir: join(work, "audit"), images: false, stt: fd.get("transcribe") ? new LocalWhisperSTT() : undefined });
      return Response.json(report);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/transcode") {
    const work = await mkdtemp(join(tmpdir(), "vidsk-tx-"));
    try {
      const input = join(work, "in.mp4");
      await writeFile(input, new Uint8Array(await req.arrayBuffer()));
      const out = await transcodeFor((url.searchParams.get("platform") ?? "tiktok") as Platform, input, join(work, "out.mp4"));
      return new Response(await readFile(out), { headers: { "content-type": "video/mp4" } });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/v1/audio/speech") {
    const b = (await req.json()) as { input: string; voice?: string; speed?: number };
    const r = await new LocalKokoroTTS().synthesize({ text: b.input, voice: b.voice, speed: b.speed });
    return new Response(r.bytes as BodyInit, { headers: { "content-type": "audio/wav" } });
  }

  return new Response("not found", { status: 404 });
}

export function startServer(port = PORT) {
  const server = createServer((req, res) => {
    let r: Request;
    try {
      r = toRequest(req);
    } catch (e) {
      res.writeHead((e as { status?: number }).status ?? 400).end(String(e));
      return;
    }
    route(r)
      .then((resp) => send(res, resp))
      .catch((e: unknown) => {
        console.error("[vidsk-render]", e);
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      });
  });
  server.requestTimeout = 0; // renders can take many minutes
  server.listen(port, () => console.log(`[vidsk-render] listening on :${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startServer();
