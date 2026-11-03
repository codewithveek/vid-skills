import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptCopy, accessToken, bytesSource, createPublisher, KVTokenStore, linkedinEscape, MemoryTokenStore, publishersFromEnv, tiktokChunks, XPublisher, xWeightedLength } from "../src/index.js";
import { MemoryStorage, VideoBrief } from "@vid-skills/core";

const copy = {
  title: "Your save icon is a 1981 fossil",
  description: "Look at your save button.\nIt's a floppy disk.",
  hashtags: ["tech", "history", "#design", "floppy disk"],
  keywords: ["floppy", "save icon"],
  hook: "Your save icon is older than you think.",
  sources: [{ url: "https://en.wikipedia.org/wiki/Floppy_disk", title: "Floppy disk" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("copy adaptation", () => {
  it("fits each platform", () => {
    expect(adaptCopy("x", copy).text.length).toBeLessThanOrEqual(280);
    expect(adaptCopy("x", { ...copy, hook: "a".repeat(400) }).text.length).toBeLessThanOrEqual(280);
    expect(adaptCopy("youtube_shorts", copy).tags).toContain("floppydisk");
    expect(adaptCopy("linkedin", copy).text).toContain("{hashtag|\\#|tech}");
    expect(adaptCopy("bluesky", copy).text.length).toBeLessThanOrEqual(300);
    expect(adaptCopy("instagram_reels", copy).text).toContain("#tech");
  });
  it("escapes linkedin reserved chars and weights x urls", () => {
    expect(linkedinEscape("a (b) #c")).toBe("a \\(b\\) \\#c");
    expect(xWeightedLength("hi https://example.com/very/long/path")).toBe(3 + 23);
  });
});

describe("tiktok chunking", () => {
  const MB = 1024 * 1024;
  it("follows the 5-64 MB rules", () => {
    expect(tiktokChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, total: 1 });
    const c = tiktokChunks(47 * MB);
    expect(c.chunkSize).toBe(10 * MB);
    expect(c.total).toBe(4); // last chunk carries the 7 MB remainder (≤ 128 MB)
    const big = tiktokChunks(20_000 * MB);
    expect(big.total).toBeLessThanOrEqual(1000);
    expect(big.chunkSize).toBeLessThanOrEqual(64 * MB);
  });
});

describe("auth", () => {
  it("refreshes and persists rotated refresh tokens", async () => {
    const store = new MemoryTokenStore();
    await store.set("x", { accessToken: "", refreshToken: "r1", expiresAt: 0 });
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      expect(String(init.body)).toContain("refresh_token=r1");
      return new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 7200 }), { headers: { "content-type": "application/json" } });
    });
    const t = await accessToken(store, "x", "x", { clientId: "id", clientSecret: "s" });
    expect(t.accessToken).toBe("a2");
    expect((await store.get("x"))?.refreshToken).toBe("r2");
  });
  it("encrypts tokens at rest in KV", async () => {
    const mem = new Map<string, string>();
    const kv = { get: async (k: string) => mem.get(k) ?? null, put: async (k: string, v: string) => void mem.set(k, v) };
    const s = new KVTokenStore(kv, "super-secret");
    await s.set("yt", { accessToken: "tok" });
    expect([...mem.values()][0]).toMatch(/^enc:/);
    expect((await s.get("yt"))?.accessToken).toBe("tok");
  });
});

describe("x publisher flow", () => {
  it("initializes, appends, finalizes and posts", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(new URL(u).pathname);
      const j = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (u.endsWith("/initialize")) return j({ data: { id: "m1" } });
      if (u.includes("/append")) return new Response(null, { status: 204 });
      if (u.endsWith("/finalize")) return j({ data: { id: "m1" } });
      if (u.endsWith("/tweets")) return j({ data: { id: "t1" } });
      return new Response("?", { status: 404 });
    });
    const p = new XPublisher({ token: async () => "tok", segmentBytes: 4 });
    const out = await p.publish({ video: bytesSource(new Uint8Array(10)), copy });
    expect(out.url).toBe("https://x.com/i/status/t1");
    expect(calls.filter((c) => c.includes("append")).length).toBe(3);
  });
});

describe("createPublisher", () => {
  it("skips platforms without credentials and validates first", async () => {
    const storage = new MemoryStorage();
    await storage.put("v.mp4", new Uint8Array(100));
    const { publishers, ready } = publishersFromEnv({});
    const pub = createPublisher({ publishers, ready });
    const r = await pub({ platform: "tiktok", videoKey: "v.mp4", copy, brief: VideoBrief.parse({ topic: "abc" }), storage });
    expect(r.status).toBe("skipped");
  });
});
