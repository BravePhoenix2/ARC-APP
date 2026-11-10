import { randomUUID } from "node:crypto";
import { maxStoredImageBytes } from "./imageLimits";

type StoredUpload = { data: Uint8Array<ArrayBuffer>; storageKey: string | null };
export class UploadStorageError extends Error {}

async function storageFetch(url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch { throw new UploadStorageError("Artwork storage is temporarily unavailable."); }
}

function supabaseStorageConfig() {
  const endpoint = process.env.SUPABASE_URL;
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.ARTIQ_SUPABASE_STORAGE_BUCKET;
  let origin: URL;
  try { origin = new URL(endpoint ?? ""); } catch { throw new UploadStorageError("Artwork storage is not configured."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !token || !bucket || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(bucket)) throw new UploadStorageError("Artwork storage is not configured.");
  return { origin: origin.origin, bucket, headers: { Authorization: `Bearer ${token}`, apikey: token } };
}

function validKey(key: string) {
  if (!/^uploads\/[a-f0-9-]{36}\.(?:png|jpeg|webp)$/.test(key)) throw new UploadStorageError("Artwork storage reference is invalid.");
  return key;
}

/** The bucket must stay private: every read goes through the existing API guard. */
async function requirePrivateBucket(config: ReturnType<typeof supabaseStorageConfig>) {
  const response = await storageFetch(`${config.origin}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`, { headers: config.headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new UploadStorageError("Artwork storage is unavailable.");
  let bucket: unknown;
  try { bucket = await response.json(); } catch { throw new UploadStorageError("Artwork storage is unavailable."); }
  if (!bucket || typeof bucket !== "object" || !("public" in bucket) || bucket.public !== false) throw new UploadStorageError("Artwork storage must use a private bucket.");
}

export async function saveUploadBytes(data: Uint8Array, mimeType: string): Promise<StoredUpload> {
  const mode = process.env.ARTIQ_UPLOAD_STORAGE ?? "database";
  if (mode === "database") return { data: new Uint8Array(data), storageKey: null };
  if (mode !== "supabase") throw new UploadStorageError("Choose a supported artwork storage provider.");
  const config = supabaseStorageConfig();
  await requirePrivateBucket(config);
  const extension = mimeType === "image/jpeg" ? "jpeg" : mimeType === "image/webp" ? "webp" : "png";
  const storageKey = `uploads/${randomUUID()}.${extension}`;
  const response = await storageFetch(`${config.origin}/storage/v1/object/${encodeURIComponent(config.bucket)}/${storageKey}`, {
    method: "POST", headers: { ...config.headers, "Content-Type": mimeType, "x-upsert": "false" }, body: new Uint8Array(data),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new UploadStorageError("Artwork storage is unavailable.");
  return { data: new Uint8Array(), storageKey };
}

/** Call only after authorizing the DB record; no public bucket URL is returned. */
export async function loadUploadBytes(image: { data: Uint8Array; storageKey?: string | null }): Promise<Uint8Array> {
  if (!image.storageKey) return image.data;
  const config = supabaseStorageConfig();
  const response = await storageFetch(`${config.origin}/storage/v1/object/authenticated/${encodeURIComponent(config.bucket)}/${validKey(image.storageKey)}`, {
    headers: config.headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || Number(response.headers.get("content-length")) > maxStoredImageBytes || !response.body) throw new UploadStorageError("Artwork storage is unavailable.");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxStoredImageBytes) { void reader.cancel().catch(() => undefined); throw new UploadStorageError("Artwork storage returned an oversized image."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (size === 0) throw new UploadStorageError("Artwork storage is unavailable.");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function removeUploadObject(storageKey: string): Promise<void> {
  const config = supabaseStorageConfig();
  const response = await storageFetch(`${config.origin}/storage/v1/object/${encodeURIComponent(config.bucket)}`, {
    method: "DELETE", headers: { ...config.headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [validKey(storageKey)] }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new UploadStorageError("Artwork storage cleanup failed.");
}
