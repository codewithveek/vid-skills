import type { Platform, PublishCopy, Storage } from "@vid-skills/core";

/** A video that can be read in chunks (R2 ranged gets, fs reads) or fetched from a public URL. */
export interface VideoSource {
  size: number;
  mime: string;
  width?: number;
  height?: number;
  durationSec?: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Public HTTPS URL when available (needed by Instagram video_url / Threads / TikTok PULL_FROM_URL). */
  publicUrl?: string;
  name?: string;
}

export function bytesSource(bytes: Uint8Array, mime = "video/mp4", extra: Partial<VideoSource> = {}): VideoSource {
  return { size: bytes.length, mime, read: async (o, l) => bytes.subarray(o, Math.min(bytes.length, o + l)), ...extra };
}

export async function storageSource(storage: Storage, key: string, extra: Partial<VideoSource> = {}): Promise<VideoSource> {
  let size = storage.size ? await storage.size(key) : null;
  if (storage.getRange && size !== null) {
    return {
      size,
      mime: "video/mp4",
      read: async (o, l) => {
        const b = await storage.getRange!(key, o, Math.min(l, size! - o));
        if (!b) throw new Error(`missing ${key}`);
        return b;
      },
      publicUrl: await httpsUrl(storage, key),
      name: key.split("/").pop(),
      ...extra,
    };
  }
  const bytes = await storage.get(key);
  if (!bytes) throw new Error(`video not found in storage: ${key}`);
  size = bytes.length;
  return bytesSource(bytes, "video/mp4", { publicUrl: await httpsUrl(storage, key), name: key.split("/").pop(), ...extra });
}

/** Only HTTPS URLs are usable by platforms that pull media (file:// or http:// are not). */
async function httpsUrl(storage: Storage, key: string): Promise<string | undefined> {
  const u = storage.publicUrl ? await storage.publicUrl(key, 6 * 3600) : null;
  return u?.startsWith("https://") ? u : undefined;
}

export async function readAll(src: VideoSource): Promise<Uint8Array> {
  return src.read(0, src.size);
}

export interface PublishInput {
  video: VideoSource;
  copy: PublishCopy;
  captionsSrt?: string;
  thumbnail?: { bytes: Uint8Array; mime: string };
  /** Mark as AI-generated where the platform supports a disclosure flag. */
  aiGenerated?: boolean;
  /** Platform-specific overrides (privacy, board id, scheduled time…). */
  options?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface PublishOutput {
  platform: Platform;
  status: "published" | "processing" | "failed" | "skipped";
  remoteId?: string;
  url?: string;
  warnings?: string[];
  error?: string;
}

export interface PlatformPublisher {
  readonly platform: Platform;
  /** Static checks before spending API quota. */
  validate(input: PublishInput): string[];
  publish(input: PublishInput): Promise<PublishOutput>;
}
