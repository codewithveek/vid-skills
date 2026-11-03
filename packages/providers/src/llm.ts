/**
 * LLM adapters. Four wire protocols cover practically every model:
 *  - OpenAI-compatible chat completions: OpenAI, Azure OpenAI, OpenRouter, Groq, Together,
 *    Fireworks, DeepSeek, Mistral, xAI, Cerebras, Perplexity, Ollama, LM Studio, vLLM,
 *    llama.cpp server, LocalAI, Gemini's OpenAI endpoint, Cloudflare AI Gateway…
 *  - Anthropic Messages (Claude)
 *  - Google Gemini generateContent
 *  - Cloudflare Workers AI (binding or REST)
 * plus `StaticLLM` (replay/testing) and `FallbackLLM` (ordered failover + circuit breaker).
 */
import type { ChatMessage, LLMCapabilities, LLMProvider, LLMRequest, LLMResponse } from "@vid-skills/core";
import { ProviderError, request, requestJson } from "./http.js";

const DEFAULT_CAPS: LLMCapabilities = { jsonSchema: false, jsonMode: true, tools: true, vision: false, contextTokens: 128_000, maxOutputTokens: 8192 };

function mergeSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  // Many APIs reject consecutive same-role turns: merge them.
  const merged: ChatMessage[] = [];
  for (const m of rest) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  if (merged[0]?.role === "assistant") merged.unshift({ role: "user", content: "Continue." });
  return { system, rest: merged };
}

/* ---------------------- OpenAI-compatible ------------------------ */

export interface OpenAICompatOptions {
  id?: string;
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
  capabilities?: Partial<LLMCapabilities>;
  /** "max_tokens" (most servers) or "max_completion_tokens" (OpenAI reasoning models) — auto-detected on 400 */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  ratePerMinute?: number;
}

export class OpenAICompatibleLLM implements LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: LLMCapabilities;
  private maxParam: "max_tokens" | "max_completion_tokens";
  private dropTemperature = false;
  private dropFormat = false;
  constructor(private readonly o: OpenAICompatOptions) {
    this.id = o.id ?? "openai-compatible";
    this.model = o.model;
    this.capabilities = { ...DEFAULT_CAPS, ...(o.capabilities ?? {}) };
    this.maxParam = o.maxTokensParam ?? "max_tokens";
  }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: req.messages,
        [this.maxParam]: req.maxTokens ?? 4096,
      };
      if (!this.dropTemperature && req.temperature !== undefined) body.temperature = req.temperature;
      if (req.stop) body.stop = req.stop;
      if (req.json && !this.dropFormat) {
        body.response_format = this.capabilities.jsonSchema
          ? { type: "json_schema", json_schema: { name: req.json.name.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: req.json.schema, strict: false } }
          : { type: "json_object" };
      }
      try {
        const j = await requestJson<{ choices?: { message?: { content?: string | null; reasoning_content?: string }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string }>(
          `${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            provider: this.id,
            method: "POST",
            headers: { "content-type": "application/json", ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}), ...(this.o.headers ?? {}) },
            body: JSON.stringify(body),
            signal: req.signal,
            rateKey: this.o.ratePerMinute ? `${this.id}:${this.model}` : undefined,
            ratePerMinute: this.o.ratePerMinute,
            retry: { timeoutMs: 300_000 },
          },
        );
        const c = j.choices?.[0];
        const fr = c?.finish_reason;
        return {
          text: c?.message?.content ?? "",
          finishReason: fr === "stop" || fr === "length" || fr === "content_filter" || fr === "tool_calls" ? fr : "other",
          usage: { inputTokens: j.usage?.prompt_tokens, outputTokens: j.usage?.completion_tokens },
          model: j.model,
        };
      } catch (e) {
        // Workarounds for server dialects: adapt and retry once per issue.
        if (e instanceof ProviderError && e.status === 400 && e.body) {
          const b = e.body.toLowerCase();
          if (b.includes("max_tokens") && this.maxParam === "max_tokens") {
            this.maxParam = "max_completion_tokens";
            continue;
          }
          if (b.includes("max_completion_tokens") && this.maxParam === "max_completion_tokens") {
            this.maxParam = "max_tokens";
            continue;
          }
          if (b.includes("temperature") && !this.dropTemperature) {
            this.dropTemperature = true;
            continue;
          }
          if ((b.includes("response_format") || b.includes("json_schema") || b.includes("json mode")) && !this.dropFormat) {
            this.dropFormat = true;
            continue;
          }
        }
        throw e;
      }
    }
    throw new ProviderError(`${this.id}: request could not be adapted to the server`, this.id, 400, false);
  }
}

/* ---------------------- Anthropic Messages ------------------------ */

export class AnthropicLLM implements LLMProvider {
  readonly id = "anthropic";
  readonly capabilities: LLMCapabilities;
  constructor(
    private readonly o: { apiKey: string; model: string; baseUrl?: string; capabilities?: Partial<LLMCapabilities>; version?: string },
  ) {
    this.capabilities = { ...DEFAULT_CAPS, jsonMode: false, contextTokens: 200_000, maxOutputTokens: 32_000, vision: true, ...(o.capabilities ?? {}) };
  }
  get model() {
    return this.o.model;
  }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const { system, rest } = mergeSystem(req.messages);
    const j = await requestJson<{ content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; model?: string }>(
      `${(this.o.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
      {
        provider: this.id,
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.o.apiKey, "anthropic-version": this.o.version ?? "2023-06-01" },
        body: JSON.stringify({
          model: this.o.model,
          max_tokens: req.maxTokens ?? 4096,
          ...(system ? { system } : {}),
          messages: rest.map((m) => ({ role: m.role, content: m.content })),
          ...(req.temperature !== undefined ? { temperature: Math.min(1, req.temperature) } : {}),
          ...(req.stop ? { stop_sequences: req.stop } : {}),
        }),
        signal: req.signal,
        retry: { timeoutMs: 600_000 },
      },
    );
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    return {
      text,
      finishReason: j.stop_reason === "max_tokens" ? "length" : j.stop_reason === "end_turn" || j.stop_reason === "stop_sequence" ? "stop" : "other",
      usage: { inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens },
      model: j.model,
    };
  }
}

/* ---------------------- Google Gemini ------------------------ */

export class GeminiLLM implements LLMProvider {
  readonly id = "gemini";
  readonly capabilities: LLMCapabilities;
  constructor(private readonly o: { apiKey: string; model: string; baseUrl?: string; capabilities?: Partial<LLMCapabilities> }) {
    this.capabilities = { ...DEFAULT_CAPS, jsonMode: true, contextTokens: 1_000_000, maxOutputTokens: 32_000, vision: true, ...(o.capabilities ?? {}) };
  }
  get model() {
    return this.o.model;
  }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const { system, rest } = mergeSystem(req.messages);
    const base = (this.o.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
    const j = await requestJson<{ candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }>(
      `${base}/models/${encodeURIComponent(this.o.model)}:generateContent`,
      {
        provider: this.id,
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.o.apiKey },
        body: JSON.stringify({
          contents: rest.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            maxOutputTokens: req.maxTokens ?? 8192,
            ...(req.json ? { responseMimeType: "application/json" } : {}),
            ...(req.stop ? { stopSequences: req.stop.slice(0, 5) } : {}),
          },
        }),
        signal: req.signal,
        retry: { timeoutMs: 300_000 },
      },
    );
    const c = j.candidates?.[0];
    const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    return { text, finishReason: c?.finishReason === "MAX_TOKENS" ? "length" : c?.finishReason === "STOP" ? "stop" : c?.finishReason === "SAFETY" ? "content_filter" : "other", usage: { inputTokens: j.usageMetadata?.promptTokenCount, outputTokens: j.usageMetadata?.candidatesTokenCount } };
  }
}

/* ---------------------- Cloudflare Workers AI ------------------------ */

/** Minimal shape of the Workers AI binding (env.AI). */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export async function runWorkersAi(o: { binding?: AiBinding; accountId?: string; apiToken?: string }, model: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (o.binding) return o.binding.run(model, input);
  if (!o.accountId || !o.apiToken) throw new ProviderError("workers-ai: need env.AI binding or CF_ACCOUNT_ID + CF_API_TOKEN", "workers-ai", undefined, false);
  const res = await request(`https://api.cloudflare.com/client/v4/accounts/${o.accountId}/ai/run/${model}`, {
    provider: "workers-ai",
    method: "POST",
    headers: { authorization: `Bearer ${o.apiToken}`, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await res.json()) as { result?: unknown };
    return j.result ?? j;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export class WorkersAiLLM implements LLMProvider {
  readonly id = "workers-ai";
  readonly capabilities: LLMCapabilities;
  constructor(private readonly o: { model: string; binding?: AiBinding; accountId?: string; apiToken?: string; capabilities?: Partial<LLMCapabilities> }) {
    this.capabilities = { ...DEFAULT_CAPS, jsonMode: false, contextTokens: 32_000, maxOutputTokens: 4096, ...(o.capabilities ?? {}) };
  }
  get model() {
    return this.o.model;
  }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const out = (await runWorkersAi(this.o, this.o.model, { messages: req.messages, max_tokens: req.maxTokens ?? 2048, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) }, req.signal)) as
      | { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string }; finish_reason?: string }[] }
      | string;
    if (typeof out === "string") return { text: out, finishReason: "stop" };
    const resp = out.response ?? out.choices?.[0]?.message?.content ?? "";
    return { text: typeof resp === "string" ? resp : JSON.stringify(resp), finishReason: out.choices?.[0]?.finish_reason === "length" ? "length" : "stop", usage: { inputTokens: out.usage?.prompt_tokens, outputTokens: out.usage?.completion_tokens } };
  }
}

/* ---------------------- Static (replay) ------------------------ */

/** Returns canned responses keyed by schema name: deterministic replays, tests and offline demos. */
export class StaticLLM implements LLMProvider {
  readonly id = "static";
  readonly model = "static";
  readonly capabilities: LLMCapabilities = { ...DEFAULT_CAPS, jsonMode: true, jsonSchema: true };
  constructor(private readonly answers: Record<string, unknown>) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const name = req.json?.name ?? "";
    const a = this.answers[name];
    if (a === undefined) throw new ProviderError(`static: no answer for ${name || "(unnamed)"}`, this.id, undefined, false);
    return { text: typeof a === "string" ? a : JSON.stringify(a), finishReason: "stop" };
  }
}

/* ---------------------- Fallback chain ------------------------ */

/**
 * Tries providers in order. A provider that fails `trip` times in a row is
 * skipped for `cooldownMs` (circuit breaker), so a dead endpoint doesn't add
 * latency to every call in a hands-free run.
 */
export class FallbackLLM implements LLMProvider {
  readonly id: string;
  private fails = new Map<number, { n: number; until: number }>();
  constructor(
    private readonly chain: LLMProvider[],
    private readonly o: { trip?: number; cooldownMs?: number } = {},
  ) {
    if (!chain.length) throw new Error("FallbackLLM needs at least one provider");
    this.id = `fallback(${chain.map((c) => c.id).join(",")})`;
  }
  get model() {
    return this.chain[0]!.model;
  }
  get capabilities() {
    // The weakest link decides what the harness may assume.
    const c = this.chain;
    return {
      jsonSchema: c.every((x) => x.capabilities.jsonSchema),
      jsonMode: c.every((x) => x.capabilities.jsonMode || x.capabilities.jsonSchema),
      tools: c.every((x) => x.capabilities.tools),
      vision: c.every((x) => x.capabilities.vision),
      contextTokens: Math.min(...c.map((x) => x.capabilities.contextTokens)),
      maxOutputTokens: Math.min(...c.map((x) => x.capabilities.maxOutputTokens)),
    };
  }
  async complete(req: LLMRequest): Promise<LLMResponse> {
    const errors: string[] = [];
    for (let i = 0; i < this.chain.length; i++) {
      const st = this.fails.get(i);
      if (st && st.until > Date.now() && i < this.chain.length - 1) continue;
      try {
        const r = await this.chain[i]!.complete(req);
        this.fails.delete(i);
        return r;
      } catch (e) {
        if (req.signal?.aborted) throw e;
        const n = (st?.n ?? 0) + 1;
        this.fails.set(i, { n, until: n >= (this.o.trip ?? 2) ? Date.now() + (this.o.cooldownMs ?? 120_000) : 0 });
        errors.push(`${this.chain[i]!.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new ProviderError(`all LLM providers failed:\n${errors.join("\n")}`, this.id, undefined, true);
  }
}
