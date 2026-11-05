import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { loadUploadBytes, saveUploadBytes, removeUploadObject, UploadStorageError } from "../../lib/uploadStorage";
import { maxImageBytes } from "../../lib/imageUpload";

const keys = ["ARTIQ_UPLOAD_STORAGE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ARTIQ_SUPABASE_STORAGE_BUCKET"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const fetchOriginal = globalThis.fetch;
const privateKey = "server-only-test-storage-credential";
const storageKey = "uploads/12345678-1234-1234-1234-123456789abc.png";
function configure() {
  process.env.ARTIQ_UPLOAD_STORAGE = "supabase";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = privateKey;
  process.env.ARTIQ_SUPABASE_STORAGE_BUCKET = "artwork-private";
}
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; }
});

test("database storage never contacts a provider and old blobs remain readable", async () => {
  process.env.ARTIQ_UPLOAD_STORAGE = "database";
  globalThis.fetch = async () => { throw new Error("Unexpected storage call"); };
  const data = new Uint8Array([1, 2, 3]);
  assert.deepEqual(await saveUploadBytes(data, "image/png"), { data, storageKey: null });
  assert.deepEqual(await loadUploadBytes({ data }), data);
});

test("Supabase uploads require a private bucket and return no public URL or credential", async () => {
  configure(); const calls: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), `Bearer ${privateKey}`);
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    if (calls.length === 1) return Response.json({ public: false });
    assert.equal(init?.method, "POST"); assert.equal(headers.get("x-upsert"), "false"); assert.equal(headers.get("content-type"), "image/png");
    assert.deepEqual(init?.body, new Uint8Array([1, 2, 3])); return Response.json({ Key: "provider-returned-object" });
  };
  const saved = await saveUploadBytes(new Uint8Array([1, 2, 3]), "image/png");
  assert.equal(saved.data.byteLength, 0); assert.match(saved.storageKey!, /^uploads\/[a-f0-9-]{36}\.png$/);
  assert.equal(calls.length, 2); assert.doesNotMatch(JSON.stringify(saved), /server-only-test|https:|provider-returned/);
  globalThis.fetch = async () => Response.json({ public: true });
  await assert.rejects(saveUploadBytes(new Uint8Array([1]), "image/png"), /private bucket/);
});

test("private object reads use authenticated storage and enforce the byte limit before buffering", async () => {
  configure(); let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(String(url), `https://project.supabase.co/storage/v1/object/authenticated/artwork-private/${storageKey}`);
    assert.equal(new Headers(init?.headers).get("apikey"), privateKey); return new Response(new Uint8Array([7, 8, 9]));
  };
  assert.deepEqual(await loadUploadBytes({ data: new Uint8Array(), storageKey }), new Uint8Array([7, 8, 9]));
  await assert.rejects(loadUploadBytes({ data: new Uint8Array(), storageKey: "uploads/../../private" }), UploadStorageError);
  assert.equal(calls, 1, "invalid keys never reach a provider");
  globalThis.fetch = async () => new Response("too big", { headers: { "content-length": String(maxImageBytes + 1) } });
  await assert.rejects(loadUploadBytes({ data: new Uint8Array(), storageKey }), UploadStorageError);
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(maxImageBytes)); controller.enqueue(new Uint8Array([1])); controller.close(); } }));
  await assert.rejects(loadUploadBytes({ data: new Uint8Array(), storageKey }), /oversized/);
});

test("provider errors and missing configuration fail closed without exposing credentials", async () => {
  configure();
  globalThis.fetch = async () => Response.json({ error: privateKey }, { status: 503 });
  await assert.rejects(loadUploadBytes({ data: new Uint8Array(), storageKey }), (error: unknown) => error instanceof UploadStorageError && !error.message.includes(privateKey));
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  await assert.rejects(saveUploadBytes(new Uint8Array([1]), "image/png"), UploadStorageError);
});

test("object cleanup deletes only the exact validated upload key", async () => {
  configure();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://project.supabase.co/storage/v1/object/artwork-private");
    assert.equal(init?.method, "DELETE"); assert.deepEqual(JSON.parse(String(init?.body)), { prefixes: [storageKey] });
    return Response.json([]);
  };
  await removeUploadObject(storageKey);
});
