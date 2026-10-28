import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Storage, StoredObject } from "@vid-skills/core";

/** Local filesystem storage (CLI, Docker, Cloud Run). Keys map to paths under `root`. */
export class FsStorage implements Storage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  path(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`key escapes storage root: ${key}`);
    return p;
  }
  async put(key: string, data: Uint8Array | string, contentType?: string): Promise<StoredObject> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return { key, size: typeof data === "string" ? Buffer.byteLength(data) : data.length, contentType };
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch {
      return null;
    }
  }
  async getText(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), "utf8");
    } catch {
      return null;
    }
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else {
          const key = relative(this.root, full).split(sep).join("/");
          if (key.startsWith(prefix)) out.push({ key, size: (await stat(full)).size });
        }
      }
    };
    await walk(this.root);
    return out;
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async publicUrl(key: string): Promise<string | null> {
    return `file://${this.path(key)}`;
  }
}
