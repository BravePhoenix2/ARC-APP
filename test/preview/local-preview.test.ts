import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/preview/screen/route";
import { localPreviewEnabled, localPreviewRequestAllowed } from "../../lib/localPreview";

const names = ["NODE_ENV", "ARTIQ_LOCAL_PREVIEW", "ARTIQ_PREVIEW_ORIGIN", "ARTIQ_AI_PIXEL_SCREENING", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"];
let previous: Record<string, string | undefined>;
let originalFetch: typeof fetch;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");

beforeEach(() => {
  previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  originalFetch = globalThis.fetch;
  delete process.env.ARTIQ_PREVIEW_ORIGIN;
  Object.assign(process.env, { NODE_ENV: "development", ARTIQ_LOCAL_PREVIEW: "true", ARTIQ_AI_PIXEL_SCREENING: "false" });
});
afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
});

function request({ itemType = "WEB2_ART", origin = "http://localhost:3000", host = "localhost:3000", fileType = "image/png", bytes = png, url = "" } = {}) {
  const form = new FormData();
  form.set("itemType", itemType);
  form.set("file", new File([new Uint8Array(bytes)], "image.png", { type: fileType }));
  return new NextRequest(url || `http://${host}/api/preview/screen`, { method: "POST", headers: { host, origin }, body: form });
}

test("preview is opt-in, development-only, and restricted to loopback hosts", async () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) assert.equal(localPreviewEnabled(host), true);
  for (const host of [null, "artiq.example", "localhost.evil.example:3000", "localhost@evil.example", "evil.example/localhost"]) assert.equal(localPreviewEnabled(host), false);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(localPreviewEnabled("localhost:3000"), false);
  assert.equal((await POST(request())).status, 404);
  Object.assign(process.env, { NODE_ENV: "development", ARTIQ_LOCAL_PREVIEW: "false" });
  assert.equal((await POST(request())).status, 404);
});

test("preview screening rejects remote hosts and foreign or missing origins", async () => {
  assert.equal((await POST(request({ host: "artiq.example", origin: "http://artiq.example" }))).status, 404);
  assert.equal((await POST(request({ origin: "https://evil.example" }))).status, 404);
  assert.equal(localPreviewRequestAllowed(new Request("http://127.0.0.1:3000/api/preview/screen", {
    headers: { host: "localhost:3000", origin: "http://localhost:3000" },
  })), false);
  const noOrigin = request(); noOrigin.headers.delete("origin");
  assert.equal((await POST(noOrigin)).status, 404);
});

test("a configured HTTPS preview works through an HTTP tunnel origin without a wallet", async () => {
  const host = "artiq-preview.trycloudflare.com";
  const origin = `https://${host}`;
  process.env.ARTIQ_PREVIEW_ORIGIN = `${origin}/`;
  assert.equal(localPreviewEnabled(host), true);
  assert.equal(localPreviewEnabled(host.toUpperCase()), true);
  for (const url of [`http://${host}/api/preview/screen`, "http://127.0.0.1:3000/api/preview/screen"]) {
    assert.equal(localPreviewRequestAllowed(request({ host, origin, url })), true);
  }
  const response = await POST(request({ host, origin, url: "http://127.0.0.1:3000/api/preview/screen" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ["screening"]);
  assert.equal(result.screening.provider.status, "NOT_CONFIGURED");
});

test("remote preview requires the exact configured host and browser origin", () => {
  const host = "artiq-preview.trycloudflare.com";
  const origin = `https://${host}`;
  process.env.ARTIQ_PREVIEW_ORIGIN = origin;
  for (const otherHost of ["another-preview.trycloudflare.com", `${host}.evil.example`, `evil.${host}`, `${host}:8443`]) {
    assert.equal(localPreviewEnabled(otherHost), false, otherHost);
    assert.equal(localPreviewRequestAllowed(request({ host: otherHost, origin })), false, otherHost);
  }
  for (const otherOrigin of ["http://artiq-preview.trycloudflare.com", "https://evil.example", "null", `${origin}/`, `${origin}:8443`]) {
    assert.equal(localPreviewRequestAllowed(request({ host, origin: otherOrigin })), false, otherOrigin);
  }
  const noOrigin = request({ host, origin }); noOrigin.headers.delete("origin");
  assert.equal(localPreviewRequestAllowed(noOrigin), false);
  const noHost = request({ host, origin }); noHost.headers.delete("host");
  assert.equal(localPreviewRequestAllowed(noHost), false);
  const forwarded = request({ host: "untrusted.example", origin });
  forwarded.headers.set("x-forwarded-host", host);
  forwarded.headers.set("x-forwarded-proto", "https");
  assert.equal(localPreviewRequestAllowed(forwarded), false);
});

test("remote preview configuration rejects non-origins, credentials, and HTTP", () => {
  const host = "artiq-preview.trycloudflare.com";
  const origin = `https://${host}`;
  for (const configured of [
    `http://${host}`, `https://user@${host}`, `https://user:password@${host}`,
    `${origin}/apply`, `${origin}?preview=true`, `${origin}#preview`,
    `//${host}`, "not a URL", "", `https://${host}:invalid`,
  ]) {
    process.env.ARTIQ_PREVIEW_ORIGIN = configured;
    assert.equal(localPreviewEnabled(host), false, configured);
    assert.equal(localPreviewRequestAllowed(request({ host, origin })), false, configured);
  }
});

test("configured preview ports must match and remote mode remains development-only and opt-in", () => {
  const host = "artiq-preview.trycloudflare.com:8443";
  const origin = `https://${host}`;
  process.env.ARTIQ_PREVIEW_ORIGIN = origin;
  assert.equal(localPreviewEnabled(host), true);
  assert.equal(localPreviewEnabled("artiq-preview.trycloudflare.com"), false);
  assert.equal(localPreviewRequestAllowed(request({ host, origin })), true);
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(localPreviewEnabled(host), false);
  assert.equal(localPreviewRequestAllowed(request({ host, origin })), false);
  Object.assign(process.env, { NODE_ENV: "development", ARTIQ_LOCAL_PREVIEW: "false" });
  assert.equal(localPreviewEnabled(host), false);
  assert.equal(localPreviewRequestAllowed(request({ host, origin })), false);
});

test("a local Art preview returns screening without saving an image or submission", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.screening.status, "REVIEW_REQUIRED");
  assert.equal(result.screening.provider.status, "NOT_CONFIGURED");
  assert.deepEqual(Object.keys(result), ["screening"]);
});

test("NFT previews never send images to the pixel detector", async () => {
  Object.assign(process.env, { ARTIQ_AI_PIXEL_SCREENING: "true", SIGHTENGINE_API_USER: "test-user", SIGHTENGINE_API_SECRET: "test-secret" });
  globalThis.fetch = async () => { assert.fail("NFT preview called an external service"); };
  const response = await POST(request({ itemType: "NFT" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).screening.provider, undefined);
});

test("preview enforces file signatures, image size, and supported types", async () => {
  assert.equal((await POST(request({ itemType: "INVALID" }))).status, 400);
  assert.equal((await POST(request({ fileType: "image/jpeg" }))).status, 400);
  assert.equal((await POST(request({ bytes: Buffer.from("<svg></svg>") }))).status, 400);
  const oversized = request(); oversized.headers.set("content-length", String(6 * 1024 * 1024));
  assert.equal((await POST(oversized)).status, 413);
});
