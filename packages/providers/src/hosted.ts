/**
 * Generic adapters for model hosts that serve thousands of models behind one
 * async-job API (fal.ai, Replicate). They make any music, image or video model
 * (MusicGen, ACE-Step, Stable Audio, FLUX, Imagen, Veo, Kling, LTX, Wan, …) pluggable
 * by name + an input template, with no code changes.
 */
import { ProviderError, findUrl, poll, requestBytes, requestJson } from "./http.js";

export interface HostedModel {
  host: "fal" | "replicate";
  model: string; // "fal-ai/flux/schnell", "meta/musicgen", or "owner/name:version"
  apiKey: string;
  /** Input template; string values may contain {{prompt}}, {{duration}}, {{width}}, {{height}}, {{aspect}}, {{image_url}} */
  input: Record<string, unknown>;
  /** Restrict which output URL to pick (by extension or content type hint). */
  outputExt?: string[];
}

function fill(tpl: unknown, vars: Record<string, string | number | undefined>): unknown {
  if (typeof tpl === "string") {
    const whole = /^\{\{(\w+)\}\}$/.exec(tpl);
    if (whole) {
      const v = vars[whole[1]!];
      return v === undefined ? undefined : v; // keep numbers numeric
    }
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fill(x, vars));
  if (tpl && typeof tpl === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(tpl)) {
      const f = fill(v, vars);
      if (f !== undefined && f !== "") o[k] = f;
    }
    return o;
  }
  return tpl;
}

export async function runHosted(m: HostedModel, vars: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string; raw: unknown }> {
  const input = fill(m.input, vars) as Record<string, unknown>;
  let result: unknown;
  if (m.host === "fal") {
    const headers = { authorization: `Key ${m.apiKey}`, "content-type": "application/json" };
    const sub = await requestJson<{ request_id: string; status_url?: string; response_url?: string }>(`https://queue.fal.run/${m.model}`, { provider: "fal", method: "POST", headers, body: JSON.stringify(input), signal });
    const statusUrl = sub.status_url ?? `https://queue.fal.run/${m.model}/requests/${sub.request_id}/status`;
    const responseUrl = sub.response_url ?? `https://queue.fal.run/${m.model}/requests/${sub.request_id}`;
    await poll(
      async () => {
        const s = await requestJson<{ status: string; error?: string }>(statusUrl, { provider: "fal", headers, signal });
        if (s.status === "COMPLETED") return true;
        if (s.status === "FAILED" || s.status === "ERROR") throw new ProviderError(`fal: job failed ${s.error ?? ""}`, "fal", undefined, false);
        return null;
      },
      { provider: "fal", signal, intervalMs: 1500, timeoutMs: 20 * 60_000 },
    );
    result = await requestJson(responseUrl, { provider: "fal", headers, signal });
  } else {
    const headers = { authorization: `Bearer ${m.apiKey}`, "content-type": "application/json", prefer: "wait=55" };
    const [ownerName, version] = m.model.split(":");
    const url = version ? "https://api.replicate.com/v1/predictions" : `https://api.replicate.com/v1/models/${ownerName}/predictions`;
    let pred = await requestJson<{ id: string; status: string; output?: unknown; error?: string; urls?: { get?: string } }>(url, {
      provider: "replicate",
      method: "POST",
      headers,
      body: JSON.stringify(version ? { version, input } : { input }),
      signal,
      retry: { timeoutMs: 120_000 },
    });
    if (pred.status !== "succeeded") {
      pred = await poll(
        async () => {
          const p = await requestJson<typeof pred>(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, { provider: "replicate", headers: { authorization: headers.authorization }, signal });
          if (p.status === "succeeded") return p;
          if (p.status === "failed" || p.status === "canceled") throw new ProviderError(`replicate: ${p.status} ${p.error ?? ""}`, "replicate", undefined, false);
          return null;
        },
        { provider: "replicate", signal, intervalMs: 2000, timeoutMs: 20 * 60_000 },
      );
    }
    result = pred.output;
  }
  const exts = m.outputExt;
  const url = findUrl(result, (u) => !exts || exts.some((e) => u.toLowerCase().split("?")[0]!.endsWith(`.${e}`))) ?? findUrl(result);
  if (!url) throw new ProviderError(`${m.host}: no output URL in result`, m.host, undefined, false);
  const { bytes, mime } = await requestBytes(url, { provider: m.host, signal, retry: { timeoutMs: 300_000 } });
  return { bytes, mime, raw: result };
}


