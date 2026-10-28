/**
 * Transports. Both are runtime-agnostic:
 *  - Streamable HTTP: `handleMcpHttp(request, server)` → Response (Workers, Deno, Bun, Node ≥ 18 via adapters)
 *  - stdio-style line framing: `serveLines(readLine, write, server)` (Node CLI wires process.stdin/stdout)
 */
import type { VidSkillsMcp } from "./server.js";

export interface HttpOptions {
  /** If set, requests must carry `Authorization: Bearer <token>`. */
  token?: string;
  /** Allowed browser origins (DNS-rebinding protection for local servers). */
  allowedOrigins?: string[];
}

export async function handleMcpHttp(req: Request, server: VidSkillsMcp, o: HttpOptions = {}): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && o.allowedOrigins && !o.allowedOrigins.includes(origin)) return new Response("forbidden origin", { status: 403 });
  if (o.token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${o.token}`) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } });
  }
  if (req.method === "GET") return new Response("SSE stream not offered; use POST (stateless Streamable HTTP).", { status: 405, headers: { allow: "POST" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
  }
  const out = await server.handleMessage(body);
  if (out === null) return new Response(null, { status: 202 });
  return Response.json(out, { headers: { "cache-control": "no-store" } });
}

/** Newline-delimited JSON-RPC loop (MCP stdio framing). */
export async function serveLines(lines: AsyncIterable<string>, write: (s: string) => void, server: VidSkillsMcp): Promise<void> {
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      continue;
    }
    // Don't block the loop on long tools: respond when each finishes.
    void server.handleMessage(msg).then((out) => {
      if (out !== null) write(JSON.stringify(out) + "\n");
    });
  }
}
