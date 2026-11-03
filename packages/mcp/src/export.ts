/**
 * The same tools, exported for hosts that don't speak MCP:
 *  - openAiTools(): OpenAI/Groq/Mistral/OpenRouter function-calling format (also accepted by most agent frameworks)
 *  - anthropicTools(): Anthropic tool-use format
 *  - geminiTools(): Gemini functionDeclarations
 *  - openApiSpec(): OpenAPI 3.1 for `POST /api/tools/{name}` (ChatGPT Actions, n8n, Zapier, Make, Dify, Flowise…)
 */
import { z } from "zod";
import { SERVER_INFO, TOOLS } from "./server.js";

const schemaOf = (t: (typeof TOOLS)[number]) => z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

export function openAiTools() {
  return TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: schemaOf(t) } }));
}

export function anthropicTools() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: schemaOf(t) }));
}

/** Gemini accepts an OpenAPI subset: strip unsupported keywords. */
export function geminiTools() {
  const strip = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(strip);
    if (s && typeof s === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s)) if (!["$schema", "additionalProperties", "default", "$ref", "$defs", "propertyNames", "exclusiveMinimum", "exclusiveMaximum"].includes(k)) o[k] = strip(v);
      return o;
    }
    return s;
  };
  return [{ functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: strip(schemaOf(t)) })) }];
}

export function openApiSpec(serverUrl = "https://vid-skills.example.workers.dev") {
  const paths: Record<string, unknown> = {};
  for (const t of TOOLS) {
    paths[`/api/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        requestBody: { required: true, content: { "application/json": { schema: schemaOf(t) } } },
        responses: { "200": { description: "Tool result", content: { "application/json": { schema: { type: "object" } } } }, "400": { description: "Invalid arguments or tool error" } },
        security: [{ bearer: [] }],
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "vid-skills", version: SERVER_INFO.version, description: "Hands-free short-form video production: research, script, voice, HyperFrames motion graphics, sound, render, publish." },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths,
  };
}
