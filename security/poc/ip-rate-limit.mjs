// Run from the repository root: node --import tsx security/poc/ip-rate-limit.mjs
// Regression check: unidentified Node/ingress requests must remain rate limited.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { NextRequestAdapter } = require("next/dist/server/web/spec-extension/adapters/next-request.js");
for (const key of ["ARTIQ_TRUSTED_PROXY", "ARTIQ_SECURITY_REDIS_URL", "ARTIQ_SECURITY_REDIS_TOKEN", "ARTIQ_RATE_LIMIT_SECRET"]) delete process.env[key];
const { withAbuseProtection, protectionClientIp, protectionPolicies } = await import(`${process.cwd()}/lib/abuseProtection.ts`);
let now = Date.now();
Date.now = () => now;
const request = (headers = {}) => NextRequestAdapter.fromNodeNextRequest({
  method: "GET", url: "http://localhost:3000/api/local-pentest", headers, body: null,
}, new AbortController().signal);
const limit = protectionPolicies.challenge.limit;
const count = limit + 5;
const handler = withAbuseProtection("pentest.no-client-ip", "challenge", async () => new Response(null, { status: 204 }));

async function scenario(name, headers, expected) {
  now += 60_000;
  const statuses = {};
  for (let i = 0; i < count; i++) {
    const response = await handler(request(headers));
    statuses[response.status] = (statuses[response.status] || 0) + 1;
  }
  assert.deepEqual(statuses, expected);
  console.log(JSON.stringify({ scenario: name, clientIp: protectionClientIp(request(headers)), configuredLimit: limit, requests: count, statuses }));
}

await scenario("default self-hosted Node adapter", {}, { 204: limit, 429: 5 });
process.env.ARTIQ_TRUSTED_PROXY = "cloudflare";
await scenario("configured trusted IP control", { "cf-connecting-ip": "192.0.2.151" }, { 204: limit, 429: 5 });
await scenario("trusted ingress header missing or malformed", { "cf-connecting-ip": "not-an-ip" }, { 204: limit, 429: 5 });
