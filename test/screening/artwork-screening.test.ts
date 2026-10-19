import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { screenArtwork } from "../../lib/artworkScreening";

const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=", "base64");
const environmentKeys = ["ARTIQ_AI_PIXEL_SCREENING", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"] as const;
const originalEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const credentials = { user: "private-test-api-user", secret: "private-test-api-secret" };

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

function enablePixelScreening() {
  process.env.ARTIQ_AI_PIXEL_SCREENING = "true";
  process.env.SIGHTENGINE_API_USER = credentials.user;
  process.env.SIGHTENGINE_API_SECRET = credentials.secret;
}

function providerResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function flaggedImage() {
  const payload = Buffer.from("parameters\0Private artist prompt\nSteps: 25, Sampler: Euler a, CFG scale: 7, Seed: 12345");
  const chunkBody = Buffer.concat([Buffer.from("tEXt"), payload]);
  let crc = 0xffffffff;
  for (const byte of Array.from(chunkBody)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([image.subarray(0, -12), length, chunkBody, checksum, image.subarray(-12)]);
}

function assertPrivate(report: unknown) {
  const serialized = JSON.stringify(report);
  for (const secret of [credentials.user, credentials.secret, "raw-provider-error", "Private artist prompt"]) {
    assert.ok(!serialized.includes(secret), `report must not expose ${secret}`);
  }
}

test("pixel screening is opt-in and never calls a provider without all configuration", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Provider must not be contacted"); };
  const configurations = [
    {},
    { ARTIQ_AI_PIXEL_SCREENING: "false", SIGHTENGINE_API_USER: credentials.user, SIGHTENGINE_API_SECRET: credentials.secret },
    { ARTIQ_AI_PIXEL_SCREENING: "true" },
    { ARTIQ_AI_PIXEL_SCREENING: "true", SIGHTENGINE_API_USER: credentials.user },
    { ARTIQ_AI_PIXEL_SCREENING: "true", SIGHTENGINE_API_SECRET: credentials.secret },
  ];
  for (const configuration of configurations) {
    for (const key of environmentKeys) delete process.env[key];
    Object.assign(process.env, configuration);
    const report = await screenArtwork(image, "image/png");
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.deepEqual(report.provider, { name: "sightengine", status: "NOT_CONFIGURED" });
    assertPrivate(report);
  }
  assert.equal(calls, 0);
});

test("an enabled pixel model receives image bytes and a high score flags for review", async () => {
  enablePixelScreening();
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.sightengine.com/1.0/check.json");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("models"), "genai");
    assert.equal(init.body.get("api_user"), credentials.user);
    assert.equal(init.body.get("api_secret"), credentials.secret);
    const uploaded = init.body.get("media");
    assert.ok(uploaded instanceof Blob);
    assert.equal(uploaded.type, "image/png");
    assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), image);
    return providerResponse({ status: "success", type: { ai_generated: 0.8 }, debug: "raw-provider-error" });
  };
  const report = await screenArtwork(image, "image/png");
  assert.equal(calls, 1);
  assert.equal(report.status, "FLAGGED");
  assert.deepEqual(report.provider, { name: "sightengine", status: "COMPLETED", score: 0.8 });
  assert.ok(report.signals.some((entry) => entry.code === "PIXEL_MODEL_FLAG"));
  assert.match(report.summary, /[Rr]eview/);
  assertPrivate(report);
});

test("a low model score still requires human review and never certifies authorship", async () => {
  enablePixelScreening();
  globalThis.fetch = async () => providerResponse({ status: "success", type: { ai_generated: 0 } });
  const report = await screenArtwork(image, "image/png");
  assert.equal(report.status, "REVIEW_REQUIRED");
  assert.deepEqual(report.provider, { name: "sightengine", status: "COMPLETED", score: 0 });
  assert.ok(!report.signals.some((entry) => entry.code === "PIXEL_MODEL_FLAG"));
  assert.doesNotMatch(JSON.stringify(report), /verified human|authentic|human-made confirmed/i);
  assert.match(report.summary, /human review required/i);
});

test("a low pixel score cannot clear generation metadata flags", async () => {
  enablePixelScreening();
  globalThis.fetch = async () => providerResponse({ status: "success", type: { ai_generated: 0.05 } });
  const report = await screenArtwork(flaggedImage(), "image/png");
  assert.equal(report.status, "FLAGGED");
  assert.equal(report.provider.status, "COMPLETED");
  assert.ok(report.signals.some((entry) => entry.code === "DIFFUSION_PARAMETERS"));
  assert.ok(!report.signals.some((entry) => entry.code === "PIXEL_MODEL_FLAG"));
  assertPrivate(report);
});

test("malformed responses fail safely without fabricating a confidence score", async () => {
  enablePixelScreening();
  for (const body of [
    null,
    {},
    { status: "failure", type: { ai_generated: 0.99 }, error: "raw-provider-error" },
    { status: "success", type: { ai_generated: "0.99" } },
    { status: "success", type: { ai_generated: -0.1 } },
    { status: "success", type: { ai_generated: 1.1 } },
    { status: "success", type: {} },
  ]) {
    globalThis.fetch = async () => providerResponse(body);
    const report = await screenArtwork(image, "image/png");
    assert.equal(report.status, "REVIEW_REQUIRED");
    assert.deepEqual(report.provider, { name: "sightengine", status: "ERROR" });
    assert.match(report.summary, /unavailable.*[Hh]uman review/);
    assertPrivate(report);
  }
});

test("HTTP, JSON, and network failures preserve local flags without exposing provider errors", async () => {
  enablePixelScreening();
  const failures: typeof fetch[] = [
    async () => providerResponse({ error: `raw-provider-error ${credentials.secret}` }, 429),
    async () => new Response("raw-provider-error", { status: 200 }),
    async () => { throw new Error(`raw-provider-error ${credentials.user} ${credentials.secret}`); },
  ];
  for (const failure of failures) {
    globalThis.fetch = failure;
    const report = await screenArtwork(flaggedImage(), "image/png");
    assert.equal(report.status, "FLAGGED");
    assert.deepEqual(report.provider, { name: "sightengine", status: "ERROR" });
    assert.ok(report.signals.some((entry) => entry.code === "DIFFUSION_PARAMETERS"));
    assertPrivate(report);
  }
});
