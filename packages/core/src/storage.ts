import type { Storage, StoredObject } from "./providers.js";

/** In-memory storage for tests, previews and single-process runs. */
export class MemoryStorage implements Storage {
  private map = new Map<string, { data: Uint8Array; type?: string }>();

  async put(key: string, data: Uint8Array | string, contentType?: string): Promise<StoredObject> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.map.set(key, { data: bytes, type: contentType });
    return { key, size: bytes.length, contentType };
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key)?.data ?? null;
  }
  async getText(key: string): Promise<string | null> {
    const b = await this.get(key);
    return b ? new TextDecoder().decode(b) : null;
  }
  async exists(key: string): Promise<boolean> {
    return this.map.has(key);
  }
  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.map.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.data.length, contentType: v.type }));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export async function putJson(storage: Storage, key: string, value: unknown): Promise<void> {
  await storage.put(key, JSON.stringify(value, null, 2), "application/json");
}

export async function getJson<T>(storage: Storage, key: string): Promise<T | null> {
  const t = await storage.getText(key);
  return t ? (JSON.parse(t) as T) : null;
}
