/**
 * Model-agnostic structured generation.
 *
 * Models differ wildly: some support constrained JSON-schema decoding, some only
 * "JSON mode", many local/small models support neither, some wrap output in
 * markdown fences or prose, some stop mid-object when they hit max tokens.
 * `generateStructured` papers over all of that:
 *
 *  1. Uses native schema decoding when the provider advertises it.
 *  2. Otherwise embeds a compact schema + example in the prompt.
 *  3. Extracts JSON from noisy text (fences, prose, trailing commas, comments).
 *  4. Continues truncated output when finishReason === "length".
 *  5. Validates with zod and runs a bounded repair loop with precise error paths.
 *  6. Trims context to the model's window.
 */
import { z } from "zod";
import type { ChatMessage, LLMProvider, LLMResponse } from "./providers.js";
import { errorMessage } from "./util.js";

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly lastText: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

/** Find and parse the first JSON value in arbitrary model output. */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  for (const m of text.matchAll(fence)) if (m[1]) candidates.push(m[1]);
  const balanced = findBalanced(text);
  if (balanced) candidates.push(balanced);
  candidates.push(text);
  let lastErr: unknown;
  for (const c of candidates) {
    for (const variant of [c, relaxJson(c)]) {
      try {
        return JSON.parse(variant.trim());
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw new Error(`no JSON found in model output: ${errorMessage(lastErr)}`);
}

function findBalanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Repairs the most common non-JSON-isms produced by models. */
export function relaxJson(s: string): string {
  return s
    .replace(/^﻿/, "")
    .replace(/\/\/[^\n"]*$/gm, "") // line comments outside strings (best effort)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1") // trailing commas
    .replace(/[“”]/g, '"')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** Approximate tokens (≈4 chars/token for English) — good enough for budgeting. */
export function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function fitToContext(messages: ChatMessage[], llm: LLMProvider, reserveOut: number): ChatMessage[] {
  const budget = Math.max(2048, llm.capabilities.contextTokens - reserveOut - 256);
  let total = messages.reduce((n, m) => n + approxTokens(m.content), 0);
  if (total <= budget) return messages;
  // Trim the longest non-system message from the middle, keeping head and tail.
  const out = messages.map((m) => ({ ...m }));
  while (total > budget) {
    let idx = -1;
    let len = 0;
    out.forEach((m, i) => {
      if (m.role !== "system" && m.content.length > len) {
        idx = i;
        len = m.content.length;
      }
    });
    if (idx < 0 || len < 400) break;
    const m = out[idx]!;
    const keep = Math.floor(m.content.length * 0.7);
    m.content = `${m.content.slice(0, keep / 2)}\n…[truncated to fit context]…\n${m.content.slice(-keep / 2)}`;
    total = out.reduce((n, x) => n + approxTokens(x.content), 0);
  }
  return out;
}

function zodIssues(err: z.ZodError): string[] {
  return err.issues.slice(0, 25).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export interface StructuredOptions<T extends z.ZodType> {
  llm: LLMProvider;
  schema: T;
  name: string;
  system: string;
  user: string;
  /** Optional example of a valid output, strongly improves small-model compliance. */
  example?: unknown;
  temperature?: number;
  maxTokens?: number;
  maxRepairs?: number;
  maxContinuations?: number;
  signal?: AbortSignal;
  onAttempt?: (info: { attempt: number; ok: boolean; issues?: string[] }) => void;
}

export async function generateStructured<T extends z.ZodType>(opts: StructuredOptions<T>): Promise<z.infer<T>> {
  const { llm, schema } = opts;
  const caps = llm.capabilities;
  const maxTokens = Math.min(opts.maxTokens ?? 8192, caps.maxOutputTokens);
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

  const schemaBlock = caps.jsonSchema
    ? ""
    : `\n\nRespond with ONE JSON value only — no prose, no markdown fences. It MUST validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}` +
      (opts.example !== undefined ? `\n\nExample of the expected shape (content is illustrative):\n${JSON.stringify(opts.example)}` : "");

  let messages: ChatMessage[] = [
    { role: "system", content: opts.system + schemaBlock },
    { role: "user", content: opts.user },
  ];

  const maxRepairs = opts.maxRepairs ?? 3;
  let lastText = "";
  let lastIssues: string[] = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    messages = fitToContext(messages, llm, maxTokens);
    const res = await completeWithContinuation(llm, messages, {
      maxTokens,
      temperature: opts.temperature ?? (attempt === 0 ? 0.7 : 0.2),
      json: caps.jsonSchema || caps.jsonMode ? { name: opts.name, schema: jsonSchema } : undefined,
      maxContinuations: opts.maxContinuations ?? 2,
      signal: opts.signal,
    });
    lastText = res.text;
    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch (e) {
      lastIssues = [errorMessage(e)];
      opts.onAttempt?.({ attempt, ok: false, issues: lastIssues });
      messages = [
        ...messages,
        { role: "assistant", content: res.text.slice(0, 4000) },
        { role: "user", content: "That was not valid JSON. Reply again with ONLY the JSON value, nothing else." },
      ];
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) {
      opts.onAttempt?.({ attempt, ok: true });
      return result.data;
    }
    lastIssues = zodIssues(result.error);
    opts.onAttempt?.({ attempt, ok: false, issues: lastIssues });
    messages = [
      ...messages,
      { role: "assistant", content: JSON.stringify(parsed).slice(0, 12000) },
      {
        role: "user",
        content: `The JSON failed validation:\n- ${lastIssues.join("\n- ")}\nReturn the corrected, complete JSON only. Keep everything that was valid.`,
      },
    ];
  }
  throw new StructuredOutputError(`${opts.name}: model output failed validation after ${maxRepairs + 1} attempts`, lastText, lastIssues);
}

/** Calls the model and, if it stops due to length, asks it to continue and stitches the text. */
export async function completeWithContinuation(
  llm: LLMProvider,
  messages: ChatMessage[],
  o: {
    maxTokens: number;
    temperature: number;
    json?: { name: string; schema: Record<string, unknown> };
    maxContinuations: number;
    signal?: AbortSignal;
  },
): Promise<LLMResponse> {
  let res = await llm.complete({ messages, maxTokens: o.maxTokens, temperature: o.temperature, json: o.json, signal: o.signal });
  let text = res.text;
  let n = 0;
  while (res.finishReason === "length" && n < o.maxContinuations) {
    n++;
    res = await llm.complete({
      messages: [
        ...messages,
        { role: "assistant", content: text },
        { role: "user", content: "You were cut off. Continue EXACTLY where you stopped, with no repetition and no commentary." },
      ],
      maxTokens: o.maxTokens,
      temperature: 0,
      signal: o.signal,
    });
    text += res.text;
  }
  return { ...res, text };
}

/** Plain text generation with the same context fitting. */
export async function generateText(llm: LLMProvider, system: string, user: string, opts: { maxTokens?: number; temperature?: number; signal?: AbortSignal } = {}): Promise<string> {
  const maxTokens = Math.min(opts.maxTokens ?? 2048, llm.capabilities.maxOutputTokens);
  const messages = fitToContext(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    llm,
    maxTokens,
  );
  const res = await completeWithContinuation(llm, messages, { maxTokens, temperature: opts.temperature ?? 0.7, maxContinuations: 1, signal: opts.signal });
  return res.text.trim();
}
