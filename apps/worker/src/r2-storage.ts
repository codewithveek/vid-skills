import type { Storage, StoredObject } from "@vid-skills/core";

/**
 * R2-backed Storage with ranged reads (chunked social uploads without loading
 * whole videos), streaming writes (renders stream straight from the container to R2),
 * and HMAC-signed public URLs served by this Worker's /files route (what
 * Instagram/Threads/TikTok PULL_FROM_URL and the render container fetch).
 */
export class R2Storage implements Storage {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly o: { origin?: string; secret?: string } = {},
  ) {}
  async put(key: string, data: Uint8Array | string, contentType?: string): Promise<StoredObject> {
    const r = await this.bucket.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined);
    return { key, size: r?.size, contentType };
  }
  async putStream(key: string, stream: ReadableStream<Uint8Array>, contentType?: string, size?: number): Promise<StoredObject> {
    let body: ReadableStream<Uint8Array> = stream;
    if (size) {
      const fixed = new FixedLengthStream(size);
      void stream.pipeTo(fixed.writable);
      body = fixed.readable;
    }
    const r = await this.bucket.put(key, body, contentType ? { httpMetadata: { contentType } } : undefined);
    return { key, size: r?.size, contentType };
  }
  async get(key: string): Promise<Uint8Array | null> {
    const o = await this.bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }
  async getText(key: string): Promise<string | null> {
    const o = await this.bucket.get(key);
    return o ? o.text() : null;
  }
  async getRange(key: string, offset: number, length: number): Promise<Uint8Array | null> {
    const o = await this.bucket.get(key, { range: { offset, length } });
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }
  async size(key: string): Promise<number | null> {
    return (await this.bucket.head(key))?.size ?? null;
  }
  async exists(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) !== null;
  }
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.bucket.list({ prefix, cursor, limit: 1000 });
      for (const o of r.objects) out.push({ key: o.key, size: o.size, contentType: o.httpMetadata?.contentType });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return out;
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
  async publicUrl(key: string, ttlSec = 6 * 3600): Promise<string | null> {
    if (!this.o.origin || !this.o.secret) return null;
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = await sign(this.o.secret, `${key}:${exp}`);
    return `${this.o.origin}/files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`;
  }
}

export async function sign(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return [...s].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Serves /files/<key>?exp&sig with Range support (platform pullers and players seek). */
export async function serveSigned(req: Request, bucket: R2Bucket, secret: string | undefined): Promise<Response> {
  const url = new URL(req.url);
  const key = decodeURIComponent(url.pathname.slice("/files/".length));
  const exp = Number(url.searchParams.get("exp"));
  if (!secret || !exp || exp < Date.now() / 1000) return new Response("expired", { status: 403 });
  if (url.searchParams.get("sig") !== (await sign(secret, `${key}:${exp}`))) return new Response("bad signature", { status: 403 });
  const range = req.headers.get("range");
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  const obj = await bucket.get(key, m ? { range: { offset: Number(m[1]), ...(m[2] ? { length: Number(m[2]) - Number(m[1]) + 1 } : {}) } } : undefined);
  if (!obj) return new Response("not found", { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("accept-ranges", "bytes");
  h.set("etag", obj.httpEtag);
  if (m && obj.range && "offset" in obj.range) {
    const off = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
    return new Response(obj.body, { status: 206, headers: h });
  }
  return new Response(obj.body, { headers: h });
}
