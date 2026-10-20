import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";

const origin = "http://127.0.0.1:3000";
const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const otherAccount = privateKeyToAccount("0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
let directory: string;
let db: typeof import("../../lib/prisma")["prisma"];
let nonceRoute: typeof import("../../app/api/auth/nonce/route");
let verifyRoute: typeof import("../../app/api/auth/verify/route");
let sessionRoute: typeof import("../../app/api/auth/session/route");
let auth: typeof import("../../lib/walletAuth");

function request(endpoint: string, body?: unknown, cookie?: string, requestOrigin = origin, headerOrigin = requestOrigin) {
  return new NextRequest(`${requestOrigin}/api/auth/${endpoint}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: headerOrigin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function challenge() {
  const response = await nonceRoute.POST(request("nonce", { walletAddress: account.address }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body: { nonce: string; message: string } = await response.json();
  const signature = await account.signMessage({ message: body.message });
  return { ...body, signature, walletAddress: account.address };
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "artiq-wallet-auth-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "auth.db")}`;
  await writeFile(path.join(directory, "auth.db"), "");
  // Verified sign-in now provisions the account and its tester profile in the
  // same transaction. Initialize the complete schema in this isolated DB.
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  [nonceRoute, verifyRoute, sessionRoute, auth] = await Promise.all([
    import("../../app/api/auth/nonce/route"),
    import("../../app/api/auth/verify/route"),
    import("../../app/api/auth/session/route"),
    import("../../lib/walletAuth"),
  ]);
});

after(async () => {
  await db?.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("rejects foreign origins, missing origins, invalid inputs, and oversized payloads", async () => {
  assert.equal((await nonceRoute.POST(request("nonce", { walletAddress: account.address }, undefined, origin, "https://attacker.example"))).status, 403);
  const noOrigin = request("nonce", { walletAddress: account.address });
  noOrigin.headers.delete("origin");
  assert.equal((await nonceRoute.POST(noOrigin)).status, 403);
  const spoofedHost = request("nonce", { walletAddress: account.address }, undefined, origin, "https://attacker.example");
  spoofedHost.headers.set("host", "attacker.example");
  spoofedHost.headers.set("x-forwarded-host", "attacker.example");
  assert.equal((await nonceRoute.POST(spoofedHost)).status, 403);
  assert.equal((await nonceRoute.POST(request("nonce", { walletAddress: "invalid" }))).status, 400);
  assert.equal((await nonceRoute.POST(request("nonce", { walletAddress: account.address, extra: "x".repeat(5000) }))).status, 400);
  assert.equal((await verifyRoute.POST(request("verify", { walletAddress: account.address, nonce: "invalid", signature: "0x00" }))).status, 400);
});

test("verifies ownership, stores only a hash, rejects replay, and revokes on sign-out", async () => {
  const signed = await challenge();
  const wrongSignature = await otherAccount.signMessage({ message: signed.message });
  assert.equal((await verifyRoute.POST(request("verify", { ...signed, signature: wrongSignature }))).status, 401);
  assert.equal((await verifyRoute.POST(request("verify", { ...signed, walletAddress: otherAccount.address }))).status, 401);

  const response = await verifyRoute.POST(request("verify", signed));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { walletAddress: account.address.toLowerCase(), isAdmin: false });
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  assert.ok(setCookie.includes("HttpOnly"));
  assert.ok(setCookie.includes("SameSite=lax"));
  const cookie = setCookie.split(";")[0];
  const token = cookie.split("=")[1];
  const stored = await db.walletSession.findUnique({ where: { tokenHash: auth.hashSessionToken(token) } });
  assert.equal(stored?.walletAddress, account.address.toLowerCase());
  assert.notEqual(stored?.tokenHash, token);
  assert.equal((await verifyRoute.POST(request("verify", signed))).status, 401);

  const session = await sessionRoute.GET(request("session", undefined, cookie));
  assert.equal(session.status, 200);
  assert.equal((await session.json()).walletAddress, account.address.toLowerCase());
  assert.equal((await sessionRoute.GET(request("session", undefined, "artiq_wallet_session=forged"))).status, 401);

  const foreignDelete = new NextRequest(`${origin}/api/auth/session`, { method: "DELETE", headers: { Cookie: cookie, Origin: "https://attacker.example" } });
  assert.equal((await sessionRoute.DELETE(foreignDelete)).status, 403);
  assert.equal((await sessionRoute.GET(request("session", undefined, cookie))).status, 200);
  const deletion = new NextRequest(`${origin}/api/auth/session`, { method: "DELETE", headers: { Cookie: cookie, Origin: origin } });
  assert.equal((await sessionRoute.DELETE(deletion)).status, 200);
  assert.equal((await sessionRoute.GET(request("session", undefined, cookie))).status, 401);
});

test("binds the signature to its origin and rejects expired challenges and sessions", async () => {
  const signed = await challenge();
  assert.match(signed.message, /Chain ID: \d+/);
  assert.match(signed.message, /Expiration Time:/);
  assert.equal((await verifyRoute.POST(request("verify", signed, undefined, "https://other.example"))).status, 401);
  await db.walletChallenge.update({ where: { nonce: signed.nonce }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await verifyRoute.POST(request("verify", signed))).status, 401);

  const fresh = await challenge();
  const response = await verifyRoute.POST(request("verify", fresh));
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  await db.walletSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await sessionRoute.GET(request("session", undefined, cookie))).status, 401);
});

test("a concurrent nonce replay cannot create two sessions", async () => {
  const signed = await challenge();
  const beforeCount = await db.walletSession.count({ where: { expiresAt: { gt: new Date() } } });
  const responses = await Promise.all([
    verifyRoute.POST(request("verify", signed)),
    verifyRoute.POST(request("verify", signed)),
  ]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(await db.walletSession.count({ where: { expiresAt: { gt: new Date() } } }), beforeCount + 1);
});

test("admin authorization fails closed and uses only the configured wallet allowlist", () => {
  const original = process.env.ARTIQ_ADMIN_WALLETS;
  try {
    delete process.env.ARTIQ_ADMIN_WALLETS;
    assert.equal(auth.isAdminWallet(account.address), false);
    process.env.ARTIQ_ADMIN_WALLETS = `invalid, ${otherAccount.address}`;
    assert.equal(auth.isAdminWallet(account.address), false);
    process.env.ARTIQ_ADMIN_WALLETS = ` ${account.address},${otherAccount.address} `;
    assert.equal(auth.isAdminWallet(account.address.toLowerCase()), true);
    assert.equal(auth.isAdminWallet("invalid"), false);
  } finally {
    if (original === undefined) delete process.env.ARTIQ_ADMIN_WALLETS;
    else process.env.ARTIQ_ADMIN_WALLETS = original;
  }
});

test("development loopback aliases preserve the browser origin and reject other ports, protocols, and subdomains", async () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, ARTIQ_APP_ORIGIN: process.env.ARTIQ_APP_ORIGIN, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
  try {
    Object.assign(process.env, { NODE_ENV: "development" });
    delete process.env.ARTIQ_APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    for (const browserOrigin of ["http://127.0.0.1:3000", "http://[::1]:3000", "http://localhost:3000"]) {
      const incoming = request("nonce", { walletAddress: account.address }, undefined, "http://localhost:3000", browserOrigin);
      assert.equal(auth.sameOrigin(incoming), true);
      assert.equal(auth.walletRequestOrigin(incoming), browserOrigin);
      const response = await nonceRoute.POST(incoming);
      assert.equal(response.status, 200);
      assert.ok((await response.json()).message.includes(`URI: ${browserOrigin}`));
    }
    for (const browserOrigin of ["http://127.0.0.1:3001", "https://127.0.0.1:3000", "http://localhost.attacker.example:3000", "http://evil.localhost:3000"]) {
      assert.equal(auth.sameOrigin(request("nonce", {}, undefined, "http://localhost:3000", browserOrigin)), false);
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("production requires the exact native or configured origin and never trusts forwarded hosts", () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, ARTIQ_APP_ORIGIN: process.env.ARTIQ_APP_ORIGIN, NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.ARTIQ_APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.equal(auth.sameOrigin(request("nonce", {}, undefined, "http://localhost:3000", "http://127.0.0.1:3000")), false);
    assert.equal(auth.sameOrigin(request("nonce", {}, undefined, "http://localhost:3000", "http://localhost:3000")), true);
    process.env.NEXT_PUBLIC_APP_URL = "https://artiq.example";
    const proxied = request("nonce", {}, undefined, "http://localhost:3000", "https://artiq.example");
    assert.equal(auth.sameOrigin(proxied), true);
    assert.equal(auth.walletRequestOrigin(proxied), "https://artiq.example");
    const spoofed = request("nonce", {}, undefined, "http://localhost:3000", "https://attacker.example");
    spoofed.headers.set("host", "attacker.example");
    spoofed.headers.set("x-forwarded-host", "attacker.example");
    spoofed.headers.set("x-forwarded-proto", "https");
    assert.equal(auth.sameOrigin(spoofed), false);
    assert.equal(auth.sameOrigin(request("nonce", {}, undefined, "http://localhost:3000", "https://artiq.example.attacker.example")), false);
    process.env.ARTIQ_APP_ORIGIN = "https://review.artiq.example";
    assert.equal(auth.sameOrigin(request("nonce", {}, undefined, "http://localhost:3000", "https://review.artiq.example")), true);
    assert.equal(auth.sameOrigin(proxied), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
