/** Research adapters: web search + page reading, with free fallbacks. */
import type { ResearchProvider, SearchResult } from "@vid-skills/core";
import { request, requestJson } from "./http.js";

export class TavilyResearch implements ResearchProvider {
  readonly id = "tavily";
  constructor(private readonly o: { apiKey: string }) {}
  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const j = await requestJson<{ results?: { url: string; title: string; content: string; raw_content?: string; published_date?: string }[] }>("https://api.tavily.com/search", {
      provider: this.id,
      method: "POST",
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, max_results: opts.limit ?? 5, search_depth: "advanced", include_raw_content: true }),
      signal: opts.signal,
    });
    return (j.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.content, content: r.raw_content?.slice(0, 8000), publishedAt: r.published_date }));
  }
}

export class ExaResearch implements ResearchProvider {
  readonly id = "exa";
  constructor(private readonly o: { apiKey: string }) {}
  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const j = await requestJson<{ results?: { url: string; title?: string; text?: string; publishedDate?: string }[] }>("https://api.exa.ai/search", {
      provider: this.id,
      method: "POST",
      headers: { "x-api-key": this.o.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, numResults: opts.limit ?? 5, contents: { text: { maxCharacters: 6000 } } }),
      signal: opts.signal,
    });
    return (j.results ?? []).map((r) => ({ url: r.url, title: r.title ?? r.url, snippet: (r.text ?? "").slice(0, 400), content: r.text, publishedAt: r.publishedDate }));
  }
}

export class BraveResearch implements ResearchProvider {
  readonly id = "brave";
  constructor(private readonly o: { apiKey: string }) {}
  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const j = await requestJson<{ web?: { results?: { url: string; title: string; description: string; age?: string }[] } }>(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${opts.limit ?? 5}`, {
      provider: this.id,
      headers: { "X-Subscription-Token": this.o.apiKey, accept: "application/json" },
      rateKey: "brave",
      ratePerMinute: 55,
      signal: opts.signal,
    });
    return (j.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.description.replace(/<[^>]+>/g, "") }));
  }
  read = readWithJina();
}

export class SearxngResearch implements ResearchProvider {
  readonly id = "searxng";
  constructor(private readonly o: { baseUrl: string }) {}
  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const j = await requestJson<{ results?: { url: string; title: string; content?: string; publishedDate?: string }[] }>(`${this.o.baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`, { provider: this.id, signal: opts.signal });
    return (j.results ?? []).slice(0, opts.limit ?? 5).map((r) => ({ url: r.url, title: r.title, snippet: r.content ?? "", publishedAt: r.publishedDate }));
  }
  read = readWithJina();
}

/** Wikipedia: free, no key, reliable baseline for well-documented topics. */
export class WikipediaResearch implements ResearchProvider {
  readonly id = "wikipedia";
  constructor(private readonly o: { lang?: string; userAgent?: string } = {}) {}
  async search(query: string, opts: { limit?: number; signal?: AbortSignal } = {}): Promise<SearchResult[]> {
    const lang = this.o.lang ?? "en";
    const headers = { "user-agent": this.o.userAgent ?? "vid-skills/0.1 (https://github.com/codewithveek/vid-skills)" };
    const j = await requestJson<{ query?: { pages?: Record<string, { title: string; extract?: string; fullurl: string }> } }>(
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${opts.limit ?? 4}&prop=extracts|info&inprop=url&explaintext=1&exlimit=max&exchars=6000`,
      { provider: this.id, headers, signal: opts.signal },
    );
    return Object.values(j.query?.pages ?? {}).map((p) => ({ url: p.fullurl, title: p.title, snippet: (p.extract ?? "").slice(0, 400), content: p.extract }));
  }
}

/** Reader: Jina r.jina.ai (works keyless at low volume) with a plain-fetch HTML→text fallback. */
export function readWithJina(apiKey?: string) {
  return async (url: string, opts: { signal?: AbortSignal } = {}): Promise<string> => {
    try {
      const res = await request(`https://r.jina.ai/${url}`, { provider: "jina", headers: { accept: "text/plain", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal: opts.signal, retry: { retries: 1, timeoutMs: 45_000 } });
      return (await res.text()).slice(0, 20_000);
    } catch {
      return readPlain(url, opts.signal);
    }
  };
}

export async function readPlain(url: string, signal?: AbortSignal): Promise<string> {
  const res = await request(url, { provider: "fetch", headers: { "user-agent": "Mozilla/5.0 (compatible; vid-skills/0.1)" }, signal, retry: { retries: 1, timeoutMs: 30_000 } });
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|h\d|li|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 20_000);
}

/** Wraps any search-only provider with a reader so pages can be fetched. */
export function withReader(p: ResearchProvider, read = readWithJina()): ResearchProvider {
  return { id: p.id, search: p.search.bind(p), read };
}
