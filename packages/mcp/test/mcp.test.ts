import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@vid-skills/core";
import { DryRunTTS, StaticLLM } from "@vid-skills/providers";
import { handleMcpHttp, openAiTools, openApiSpec, VidSkillsMcp } from "../src/index.js";
import { dossier, script, storyboard } from "../../core/test/fixtures.js";

const llm = new StaticLLM({
  ResearchDossier: dossier,
  Script: script,
  Storyboard: storyboard,
  PublishCopy: { title: "t", description: "d", hashtags: [], keywords: [], sources: [] },
});
const server = () => new VidSkillsMcp({ providers: () => ({ llm, tts: new DryRunTTS() }), storage: new MemoryStorage() });

describe("mcp server", () => {
  it("initializes and lists tools/resources/prompts", async () => {
    const s = server();
    const init = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect((init!.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    const tools = (await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }))!.result as { tools: { name: string; inputSchema: unknown }[] };
    expect(tools.tools.map((t) => t.name)).toContain("make_video");
    const res = (await s.handle({ jsonrpc: "2.0", id: 3, method: "resources/list" }))!.result as { resources: { uri: string }[] };
    expect(res.resources.some((r) => r.uri === "vidsk://schemas")).toBe(true);
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
  it("runs make_video inline up to compose and serves project files", async () => {
    const s = server();
    const r = await s.callTool("make_video", { brief: { topic: "floppy disk icon", durationSec: 20 }, stopAfter: "compose", wait: true });
    expect(r.isError).toBeFalsy();
    const jobId = (r.structuredContent as { jobId: string }).jobId;
    const files = await s.callTool("get_project_file", { jobId });
    expect(files.content[0]!.text).toContain("index.html");
    const idx = await s.callTool("get_project_file", { jobId, path: "index.html" });
    expect(idx.content[0]!.text).toContain("data-composition-id");
    const qa = await s.callTool("qa_report", { jobId });
    expect(qa.isError).toBeFalsy();
  });
  it("returns validation errors as tool errors", async () => {
    const r = await server().callTool("make_video", { brief: { topic: 1 } });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/Invalid arguments/);
  });
  it("speaks streamable http with bearer auth", async () => {
    const s = server();
    const unauth = await handleMcpHttp(new Request("https://x/mcp", { method: "POST", body: "{}" }), s, { token: "t" });
    expect(unauth.status).toBe(401);
    const res = await handleMcpHttp(new Request("https://x/mcp", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]) }), s, { token: "t" });
    expect(await res.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });
  it("exports tool definitions for non-MCP hosts", () => {
    expect(openAiTools()[0]!.function.parameters).toHaveProperty("type", "object");
    expect(Object.keys(openApiSpec().paths)).toContain("/api/tools/make_video");
  });
});
