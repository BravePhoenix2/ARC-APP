// Regression checks; POSTs use invalid data and cannot create accounts or challenges.
// Run only against a disposable local app: node security/poc/local-http.mjs http://127.0.0.1:4320
import assert from "node:assert/strict";

const base = new URL(process.argv[2] || "http://127.0.0.1:4320");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Only loopback targets are permitted");
assert.equal(base.protocol, "http:");
assert.equal(base.pathname, "/");
assert.ok(!base.username && !base.password && !base.search && !base.hash);
const checks = [];
const root = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(15000) });
await root.arrayBuffer();
const securityHeaders = Object.fromEntries(
  ["content-security-policy", "x-frame-options", "referrer-policy", "x-content-type-options", "strict-transport-security", "x-powered-by"]
    .map((key) => [key, root.headers.get(key)]));
assert.equal(root.status, 200);
assert.match(securityHeaders["content-security-policy"] || "", /frame-ancestors 'none'/);
assert.equal(securityHeaders["x-frame-options"], "DENY");
assert.equal(securityHeaders["x-content-type-options"], "nosniff");
assert.equal(securityHeaders["referrer-policy"], "strict-origin-when-cross-origin");
assert.equal(securityHeaders["x-powered-by"], null);
console.log(JSON.stringify({ observation: "HTML security headers", status: root.status, headers: securityHeaders, pass: true }));

async function check(name, path, expected, method = "GET", headers = {}, body) {
  const response = await fetch(new URL(path, base), {
    method, redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Origin: base.origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await response.arrayBuffer();
  const result = { check: name, method, path, status: response.status, expected, pass: expected.includes(response.status) };
  checks.push(result);
  console.log(JSON.stringify(result));
}

await check("anonymous security metrics", "/api/admin/security", [401]);
await check("anonymous reviewer queue", "/api/admin/submissions", [401]);
await check("anonymous review mutation", "/api/admin/submissions/missing", [401], "PATCH", {}, { decision: "APPROVED" });
await check("anonymous private submissions", "/api/submissions", [401]);
await check("anonymous submission mutation", "/api/submissions", [401], "POST", {}, {});
await check("anonymous private watchlist", "/api/watchlist", [401]);
await check("anonymous private auction drafts", "/api/asset-auctions?mine=1", [401]);
await check("anonymous fulfillment", "/api/asset-auctions/missing/fulfillment", [401]);
await check("anonymous image upload", "/api/uploads", [401], "POST", {}, {});
await check("cross-origin upload", "/api/uploads", [403], "POST", { Origin: "https://foreign.invalid" }, {});
await check("cross-origin review", "/api/admin/submissions/missing", [403], "PATCH", { Origin: "https://foreign.invalid" }, { decision: "APPROVED" });
await check("cross-origin wallet challenge", "/api/auth/nonce", [403], "POST", { Origin: "https://foreign.invalid" }, {});
await check("middleware bypass header on admin API", "/api/admin/security", [401], "GET", { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" });
await check("forged reviewer/account headers", "/api/admin/submissions", [401], "GET", { "X-Artiq-Account-ID": "reviewer", "X-Wallet-Address": "0x1111111111111111111111111111111111111111", "X-Admin": "true" });
await check("forged session cookie", "/api/admin/security", [401], "GET", { Cookie: `artiq_email_session=${"a".repeat(64)}` });
await check("public creation disabled", "/api/items", [405], "POST", {}, {});
await check("invalid catalog type", "/api/items?itemType=ADMIN", [400]);
await check("unbounded catalog limit", "/api/items?limit=1000000", [400]);
await check("invalid catalog cursor", "/api/items?cursor=not-a-valid-cursor", [400]);
await check("private env path", "/.env.local", [404]);
await check("private git path", "/.git/config", [404]);
await check("private database path", "/prisma/dev.db", [404]);

// Invalid wallet input is rejected before any challenge/database creation.
const statuses = {};
for (let i = 0; i < 65; i++) {
  const response = await fetch(new URL("/api/auth/nonce", base), {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Origin: base.origin, "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: "invalid" }),
  });
  await response.arrayBuffer();
  statuses[response.status] = (statuses[response.status] || 0) + 1;
}
console.log(JSON.stringify({ observation: "65 invalid challenge requests; configured challenge quota is 60/minute", statuses }));
assert.ok((statuses[429] || 0) >= 5, "Unidentified clients must still be rate limited");
const passed = checks.filter((check) => check.pass).length;
console.log(JSON.stringify({ summary: { passed, failed: checks.length - passed, checks: checks.length } }));
if (passed !== checks.length) process.exitCode = 1;
