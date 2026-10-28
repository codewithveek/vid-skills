/**
 * OAuth plumbing for hands-free publishing: authorize-URL builders, code exchange,
 * refresh (including providers that ROTATE refresh tokens: X, TikTok), and a
 * pluggable TokenStore (Workers KV, file, memory, env).
 */
import { ProviderError, requestJson } from "@vid-skills/providers";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
  /** platform-specific ids discovered during auth (open_id, user id, author URN…) */
  extra?: Record<string, string>;
}

export interface TokenStore {
  get(key: string): Promise<TokenSet | null>;
  set(key: string, t: TokenSet): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private m = new Map<string, TokenSet>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, t: TokenSet) {
    this.m.set(k, t);
  }
}

/** Minimal KV shape (Cloudflare KV, Deno KV adapters, Redis wrappers…). Values are AES-GCM encrypted when a key is given. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export class KVTokenStore implements TokenStore {
  constructor(
    private readonly kv: KVLike,
    private readonly secret?: string,
    private readonly prefix = "tokens:",
  ) {}
  private async key(): Promise<CryptoKey | null> {
    if (!this.secret) return null;
    const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.secret));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async get(k: string): Promise<TokenSet | null> {
    const v = await this.kv.get(this.prefix + k);
    if (!v) return null;
    const key = await this.key();
    if (!key || !v.startsWith("enc:")) return JSON.parse(v) as TokenSet;
    const [ivB64, ctB64] = v.slice(4).split(".");
    const iv = Uint8Array.from(atob(ivB64!), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64!), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(pt)) as TokenSet;
  }
  async set(k: string, t: TokenSet): Promise<void> {
    const key = await this.key();
    if (!key) return this.kv.put(this.prefix + k, JSON.stringify(t));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(t))));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    await this.kv.put(this.prefix + k, `enc:${b64(iv)}.${b64(ct)}`);
  }
}

export interface OAuthApp {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
}

interface OAuthSpec {
  authorize: string;
  token: string;
  scopes: string[];
  /** how the client authenticates on the token endpoint */
  clientAuth: "body" | "basic" | "tiktok";
  pkce?: boolean;
  scopeSep?: string;
  extraAuthorize?: Record<string, string>;
}

export const OAUTH: Record<string, OAuthSpec> = {
  youtube: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"],
    clientAuth: "body",
    extraAuthorize: { access_type: "offline", prompt: "consent" },
  },
  tiktok: {
    authorize: "https://www.tiktok.com/v2/auth/authorize/",
    token: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.upload"],
    clientAuth: "tiktok",
    scopeSep: ",",
  },
  x: {
    authorize: "https://x.com/i/oauth2/authorize",
    token: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
    clientAuth: "basic",
    pkce: true,
  },
  linkedin: {
    authorize: "https://www.linkedin.com/oauth/v2/authorization",
    token: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    clientAuth: "body",
  },
  pinterest: {
    authorize: "https://www.pinterest.com/oauth/",
    token: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["boards:read", "pins:read", "pins:write"],
    clientAuth: "basic",
    scopeSep: ",",
  },
  meta: {
    authorize: "https://www.facebook.com/dialog/oauth",
    token: "https://graph.facebook.com/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"],
    clientAuth: "body",
  },
  threads: {
    authorize: "https://threads.net/oauth/authorize",
    token: "https://graph.threads.net/oauth/access_token",
    scopes: ["threads_basic", "threads_content_publish"],
    clientAuth: "body",
    scopeSep: ",",
  },
};

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const rnd = crypto.getRandomValues(new Uint8Array(32));
  const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const verifier = b64url(rnd);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

/** Build the consent URL. Persist `state` and `verifier` until the callback. */
export async function authorizeUrl(platform: keyof typeof OAUTH, app: OAuthApp, state: string): Promise<{ url: string; verifier?: string }> {
  const s = OAUTH[platform]!;
  const p = new URLSearchParams({ response_type: "code", redirect_uri: app.redirectUri ?? "", scope: s.scopes.join(s.scopeSep ?? " "), state, ...(s.extraAuthorize ?? {}) });
  if (s.clientAuth === "tiktok") p.set("client_key", app.clientId);
  else p.set("client_id", app.clientId);
  let verifier: string | undefined;
  if (s.pkce) {
    const pk = await pkcePair();
    verifier = pk.verifier;
    p.set("code_challenge", pk.challenge);
    p.set("code_challenge_method", "S256");
  }
  return { url: `${s.authorize}?${p.toString()}`, verifier };
}

async function tokenCall(platform: keyof typeof OAUTH, app: OAuthApp, params: Record<string, string>): Promise<TokenSet> {
  const s = OAUTH[platform]!;
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (s.clientAuth === "basic") {
    if (app.clientSecret) headers.authorization = `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`;
    body.set("client_id", app.clientId);
  } else if (s.clientAuth === "tiktok") {
    body.set("client_key", app.clientId);
    if (app.clientSecret) body.set("client_secret", app.clientSecret);
  } else {
    body.set("client_id", app.clientId);
    if (app.clientSecret) body.set("client_secret", app.clientSecret);
  }
  const j = await requestJson<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; open_id?: string; error?: string; error_description?: string }>(s.token, {
    provider: `${platform}-oauth`,
    method: "POST",
    headers,
    body: body.toString(),
  });
  if (!j.access_token) throw new ProviderError(`${platform} oauth: ${j.error ?? "no access_token"} ${j.error_description ?? ""}`, `${platform}-oauth`, 400, false);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    scope: j.scope,
    extra: j.open_id ? { open_id: j.open_id } : undefined,
  };
}

export function exchangeCode(platform: keyof typeof OAUTH, app: OAuthApp, code: string, verifier?: string): Promise<TokenSet> {
  return tokenCall(platform, app, { grant_type: "authorization_code", code, redirect_uri: app.redirectUri ?? "", ...(verifier ? { code_verifier: verifier } : {}) });
}

/**
 * Returns a valid access token for `key`, refreshing ≥ 2 minutes before expiry
 * and persisting rotated refresh tokens (X and TikTok issue a new one per refresh —
 * losing it locks the account out until a human re-authorizes).
 */
export async function accessToken(store: TokenStore, key: string, platform: keyof typeof OAUTH, app?: OAuthApp): Promise<TokenSet> {
  const t = await store.get(key);
  if (!t) throw new ProviderError(`${platform}: no token stored under "${key}". Authorize first (see docs/distribution.md).`, platform, 401, false);
  const valid = !!t.accessToken && (t.expiresAt === undefined || t.expiresAt - Date.now() > 120_000);
  if (valid) return t;
  if (!t.refreshToken || !app) {
    if (t.accessToken) return t; // let the API decide; it may still be valid
    throw new ProviderError(`${platform}: access token missing/expired and no refresh token + client credentials to renew it`, platform, 401, false);
  }
  const fresh = await tokenCall(platform, app, { grant_type: "refresh_token", refresh_token: t.refreshToken });
  const merged: TokenSet = { ...t, ...fresh, refreshToken: fresh.refreshToken ?? t.refreshToken, extra: { ...(t.extra ?? {}), ...(fresh.extra ?? {}) } };
  await store.set(key, merged);
  return merged;
}

/** Threads long-lived tokens refresh through a GET endpoint (valid 60 days, refreshable after 24 h). */
export async function refreshThreadsToken(store: TokenStore, key: string): Promise<TokenSet> {
  const t = await store.get(key);
  if (!t) throw new ProviderError(`threads: no token under ${key}`, "threads", 401, false);
  if (t.expiresAt && t.expiresAt - Date.now() > 7 * 86_400_000) return t;
  const j = await requestJson<{ access_token: string; expires_in: number }>(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(t.accessToken)}`, { provider: "threads-oauth" });
  const n = { ...t, accessToken: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  await store.set(key, n);
  return n;
}
