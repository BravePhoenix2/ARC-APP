import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hash } from "viem";

// All identities, JWT keys, uploads, sessions and receipts belong to this
// disposable process. The fetch stub permits only local Privy API fixtures;
// these tests cannot send mail, call an RPC, or contact a real Privy app.
const directory = mkdtempSync(join(tmpdir(), "artiq-privy-auth-"));
const origin = "http://localhost:3000";
const appId = "clartiqprivytest00000000001";
const ownerWallet = "0x1111111111111111111111111111111111111111" as Address;
const otherWallet = "0x2222222222222222222222222222222222222222" as Address;
const reviewerWallet = "0x9999999999999999999999999999999999999999" as Address;
const reviewerEmail = "reviewer@example.com";
const market = "0x3333333333333333333333333333333333333333" as Address;
const cookieName = "artiq_privy_session";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
process.env.DATABASE_URL = `file:${join(directory, "auth.db")}`;
process.env.ARTIQ_APP_ORIGIN = origin;
process.env.NEXT_PUBLIC_PRIVY_APP_ID = appId;
process.env.PRIVY_APP_ID = appId;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_ART_MARKET_ADDRESS = market;
process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
process.env.ARTIQ_ADMIN_WALLETS = reviewerWallet;
process.env.ARTIQ_ADMIN_EMAILS = reviewerEmail;
process.env.GMAIL_SMTP_USER = "test.sender@gmail.com";
process.env.GMAIL_SMTP_APP_PASSWORD = "abcdefghijklmnop";
process.env.ARTIQ_EMAIL_CODE_SECRET = "01".repeat(32);

type Tokens = { accessToken: string; identityToken: string };
type PublicUser = { id: string; email: string | null; walletAddress: string | null; walletAddresses: string[]; authMethod: string; isAdmin: boolean };
type Login = { user: PublicUser; cookie: string; privyDid: string; expiresAt: string };
type LinkedAccount = Record<string, unknown>;
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicJwk: JWK;
let auth: typeof import("../../lib/privyAuth");
let route: typeof import("../../app/api/auth/privy/session/route");
let db: typeof import("../../lib/prisma")["prisma"];
let board: typeof import("../../lib/testerLeaderboard");
let submissions: typeof import("../../app/api/submissions/route");
let uploads: typeof import("../../app/api/uploads/route");
let imageRoute: typeof import("../../app/api/uploads/[id]/route");
let adminQueue: typeof import("../../app/api/admin/submissions/route");
let reviewRoute: typeof import("../../app/api/admin/submissions/[id]/route");
let activityRoute: typeof import("../../app/api/tester/activity/route");
let legacyNonce: typeof import("../../app/api/auth/nonce/route");
let legacyWalletVerify: typeof import("../../app/api/auth/verify/route");
let legacyEmailRequest: typeof import("../../app/api/auth/email/request/route");
let legacyEmailVerify: typeof import("../../app/api/auth/email/verify/route");
let legacyWalletSession: typeof import("../../app/api/auth/session/route");
let legacyEmailSession: typeof import("../../app/api/auth/email/session/route");
let restoreRpc: (() => void) | undefined;
let restoreMailer: (() => void) | undefined;
let originalFetch: typeof fetch;
const receipts = new Map<string, Record<string, unknown>>();
const fetchedUrls: string[] = [];
let rpcReads = 0;
let mailAttempts = 0;
let jwksFailureAppId: string | null = null;
type CurrentUserPlan = { body?: unknown; raw?: string; status?: number; headers?: Record<string, string>; failure?: "network" | "timeout"; networkCode?: string; failureDetails?: string };
const currentUserPlans: CurrentUserPlan[] = [];
const currentUserRequests: Array<{ method: string; headers: Headers; redirect: RequestRedirect | undefined; signal: AbortSignal | null | undefined }> = [];

const nowSeconds = () => Math.floor(Date.now() / 1000);
const did = () => `did:privy:${randomBytes(12).toString("hex")}`;
const emailAccount = (address: string): LinkedAccount => ({ type: "email", address, lv: nowSeconds() - 1 });
const walletAccount = (address: string, extra: LinkedAccount = {}): LinkedAccount => ({ type: "wallet", address, chain_type: "ethereum", wallet_client_type: "metamask", lv: nowSeconds() - 1, ...extra });
const fullEmailAccount = (address: string): LinkedAccount => ({ type: "email", address, first_verified_at: nowSeconds() - 100, latest_verified_at: nowSeconds() - 1, verified_at: nowSeconds() - 1 });
const fullWalletAccount = (address: string): LinkedAccount => ({ type: "wallet", address, chain_type: "ethereum", wallet_client_type: "metamask", first_verified_at: nowSeconds() - 100, latest_verified_at: nowSeconds() - 1, verified_at: nowSeconds() - 1 });
const currentUserBody = (privyDid: string, accounts: LinkedAccount[]) => ({ user: { id: privyDid, created_at: nowSeconds() - 100, linked_accounts: accounts }, identity_token: null });

function request(path: string, method = "GET", body?: unknown, login?: Pick<Login, "user" | "cookie">, selectedWallet?: string, browserOrigin = origin) {
  return new NextRequest(`${origin}${path}`, {
    method,
    headers: {
      Origin: browserOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(login ? { Cookie: login.cookie, "X-Artiq-Account-ID": login.user.id } : {}),
      ...(selectedWallet ? { "X-Wallet-Address": selectedWallet } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function tokenPair(input: { privyDid?: string; accounts?: LinkedAccount[]; accessClaims?: JWTPayload; identityClaims?: JWTPayload } = {}): Promise<Tokens> {
  const subject = input.privyDid ?? did();
  const common = { iss: "privy.io", aud: appId, sub: subject, iat: nowSeconds(), exp: nowSeconds() + 3600 };
  return {
    accessToken: await new SignJWT({ ...common, sid: `sid-${randomBytes(8).toString("hex")}`, ...input.accessClaims }).setProtectedHeader({ alg: "ES256", kid: "artiq-test-key", typ: "JWT" }).sign(signingKey),
    identityToken: await new SignJWT({ ...common, linked_accounts: JSON.stringify(input.accounts ?? [emailAccount("creator@example.com")]), ...input.identityClaims }).setProtectedHeader({ alg: "ES256", kid: "artiq-test-key", typ: "JWT" }).sign(signingKey),
  };
}

async function login(accounts: LinkedAccount[] = [emailAccount("creator@example.com")], options: { privyDid?: string; preferredAccountId?: string; legacyCookie?: string; selectedWallet?: string } = {}): Promise<Login> {
  const privyDid = options.privyDid ?? did();
  const tokens = await tokenPair({ privyDid, accounts });
  const incoming = request("/api/auth/privy/session", "POST", { ...tokens, ...(options.preferredAccountId ? { preferredAccountId: options.preferredAccountId } : {}) }, undefined, options.selectedWallet);
  if (options.legacyCookie) {
    for (const cookie of options.legacyCookie.split(";")) {
      const [name, value] = cookie.trim().split("=");
      incoming.cookies.set(name, value);
    }
  }
  const response = await route.POST(incoming);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.user.authMethod, "PRIVY");
  const rawCookie = response.headers.get("set-cookie");
  assert.ok(rawCookie);
  const value = rawCookie.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)?.[1];
  assert.match(value ?? "", /^[a-f0-9]{64}$/);
  assert.ok(rawCookie.includes("HttpOnly"));
  assert.ok(rawCookie.includes("SameSite=lax"));
  return { ...body, cookie: `${cookieName}=${value}`, privyDid };
}

async function legacyEmail(email: string) {
  const user = await db.user.create({ data: { email, emailVerifiedAt: new Date() } });
  const token = randomBytes(32).toString("hex");
  await db.emailSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  await board.ensureTesterProfile(db, user.id);
  return { user, cookie: `artiq_email_session=${token}` };
}

async function legacyWallet(walletAddress: string) {
  const user = await db.user.create({ data: { walletAddress } });
  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  await board.ensureTesterProfile(db, user.id);
  return { user, cookie: `artiq_wallet_session=${token}` };
}

function artReceipt(wallet: Address): Hash {
  const hash = `0x${randomBytes(32).toString("hex")}` as Hash;
  const abi = parseAbi(["event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)"]);
  receipts.set(hash, { status: "success", from: wallet, to: market, logs: [{ address: market, topics: encodeEventTopics({ abi, eventName: "ArtPurchased", args: { listingId: BigInt(1), buyer: wallet } }), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(1)]) }] });
  return hash;
}

before(async () => {
  writeFileSync(join(directory, "auth.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  const pair = await generateKeyPair("ES256");
  signingKey = pair.privateKey;
  publicJwk = { ...await exportJWK(pair.publicKey), kid: "artiq-test-key", alg: "ES256", use: "sig" };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    fetchedUrls.push(url);
    if (url === "https://auth.privy.io/api/v1/users/me") {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      currentUserRequests.push({ method, headers, redirect: init?.redirect, signal: init?.signal });
      assert.equal(method, "GET", "the fallback uses Privy's official current-user read endpoint");
      assert.equal(headers.get("privy-app-id"), appId);
      assert.match(headers.get("authorization") ?? "", /^Bearer ey/);
      assert.equal(init?.redirect, "error", "provider redirects must not receive the user's bearer token");
      assert.ok(init?.signal instanceof AbortSignal, "the provider read must have a timeout signal");
      const plan = currentUserPlans.shift();
      assert.ok(plan, "all current-user reads must have a deliberate local fixture");
      if (plan.failure === "network") throw Object.assign(new TypeError("fetch failed"), { cause: { code: plan.networkCode ?? "ECONNRESET", message: plan.failureDetails } });
      if (plan.failure === "timeout") throw new DOMException(plan.failureDetails ?? "Fixture request timed out", "TimeoutError");
      return new Response(plan.raw ?? JSON.stringify(plan.body ?? {}), {
        status: plan.status ?? 200, headers: { "Content-Type": "application/json", ...plan.headers },
      });
    }
    if (jwksFailureAppId && url === `https://auth.privy.io/api/v1/apps/${jwksFailureAppId}/jwks.json`) {
      throw new TypeError("fetch failed");
    }
    assert.equal(url, `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`, "only the configured official JWKS endpoint may be contacted");
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const mailers = Array.from(new Set([
    (await import("nodemailer")).default,
    createRequire(join(process.cwd(), "package.json"))("nodemailer").default as typeof import("nodemailer"),
  ]));
  const originalMailers = mailers.map((mailer) => mailer.createTransport);
  for (const mailer of mailers) Object.assign(mailer, {
    createTransport: () => ({
      sendMail: async () => { mailAttempts++; throw new Error("No SMTP calls are permitted in the Privy integration suite."); },
      close: () => undefined,
    }),
  });
  restoreMailer = () => mailers.forEach((mailer, index) => Object.assign(mailer, { createTransport: originalMailers[index] }));
  ({ prisma: db } = await import("../../lib/prisma"));
  [auth, route, board, submissions, uploads, imageRoute, adminQueue, activityRoute, reviewRoute] = await Promise.all([
    import("../../lib/privyAuth"), import("../../app/api/auth/privy/session/route"), import("../../lib/testerLeaderboard"),
    import("../../app/api/submissions/route"), import("../../app/api/uploads/route"), import("../../app/api/uploads/[id]/route"),
    import("../../app/api/admin/submissions/route"), import("../../app/api/tester/activity/route"),
    import("../../app/api/admin/submissions/[id]/route"),
  ]);
  [legacyNonce, legacyWalletVerify, legacyEmailRequest, legacyEmailVerify, legacyWalletSession, legacyEmailSession] = await Promise.all([
    import("../../app/api/auth/nonce/route"), import("../../app/api/auth/verify/route"),
    import("../../app/api/auth/email/request/route"), import("../../app/api/auth/email/verify/route"),
    import("../../app/api/auth/session/route"), import("../../app/api/auth/email/session/route"),
  ]);
  const { deploymentClient } = await import("../../lib/deploymentVerification");
  const original = { getChainId: deploymentClient.getChainId, getTransactionReceipt: deploymentClient.getTransactionReceipt, readContract: deploymentClient.readContract };
  Object.assign(deploymentClient, {
    getChainId: async () => { rpcReads++; return 5042002; },
    getTransactionReceipt: async ({ hash }: { hash: string }) => { rpcReads++; const receipt = receipts.get(hash); assert.ok(receipt, "all receipt reads must come from the in-process fixture"); return receipt; },
    readContract: async () => { throw new Error("Unexpected contract read; no real RPC is permitted."); },
  });
  restoreRpc = () => Object.assign(deploymentClient, original);
});

beforeEach(async () => {
  await db.testerMilestone.deleteMany();
  await db.testerProfile.deleteMany();
  await db.submission.deleteMany();
  await db.activity.deleteMany();
  await db.listing.deleteMany();
  await db.item.deleteMany();
  await db.uploadedImage.deleteMany();
  await db.privySession.deleteMany();
  await db.emailSession.deleteMany();
  await db.walletSession.deleteMany();
  await db.emailChallenge.deleteMany();
  await db.walletChallenge.deleteMany();
  await db.user.deleteMany();
  receipts.clear(); rpcReads = 0; mailAttempts = 0; jwksFailureAppId = null;
  currentUserPlans.length = 0;
  currentUserRequests.length = 0;
});

after(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  restoreRpc?.();
  restoreMailer?.();
  await db?.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("rejects unconfigured, foreign, malformed and oversized sign-ins before creating accounts", async () => {
  const original = { PRIVY_APP_ID: process.env.PRIVY_APP_ID, NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID };
  try {
    delete process.env.PRIVY_APP_ID;
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    assert.equal((await route.POST(request("/api/auth/privy/session", "POST", { accessToken: "fake", identityToken: "fake" }))).status, 503);
  } finally { Object.assign(process.env, original); }
  const tokens = await tokenPair();
  const foreign = request("/api/auth/privy/session", "POST", tokens, undefined, undefined, "https://attacker.example");
  foreign.headers.set("host", "attacker.example");
  foreign.headers.set("x-forwarded-host", "attacker.example");
  assert.equal((await route.POST(foreign)).status, 403);
  const missing = request("/api/auth/privy/session", "POST", tokens);
  missing.headers.delete("origin");
  assert.equal((await route.POST(missing)).status, 403);
  for (const body of [null, [], {}, { ...tokens, identityToken: {} }, { ...tokens, forceProfileRefresh: "true" }, { ...tokens, preferredAccountId: { id: "spoofed" } }, { ...tokens, extra: "x".repeat(100_000) }]) {
    assert.equal((await route.POST(request("/api/auth/privy/session", "POST", body))).status, 400);
  }
  const malformed = new NextRequest(`${origin}/api/auth/privy/session`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{" });
  assert.equal((await route.POST(malformed)).status, 400);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
  assert.equal(await db.testerProfile.count(), 0);
});

test("configured Privy disables legacy sign-in issuance while preserving existing sessions for migration", async () => {
  const email = await legacyEmail("legacy-auth@example.com");
  const wallet = await legacyWallet(ownerWallet);
  const counters = async () => Promise.all([
    db.user.count(), db.walletChallenge.count(), db.emailChallenge.count(),
    db.walletSession.count(), db.emailSession.count(), db.privySession.count(), db.testerProfile.count(),
  ]);
  const before = await counters();
  const attempts = [
    [legacyNonce, "/api/auth/nonce", { walletAddress: ownerWallet }],
    [legacyWalletVerify, "/api/auth/verify", { walletAddress: ownerWallet, nonce: "aa".repeat(24), signature: `0x${"bb".repeat(65)}` }],
    [legacyEmailRequest, "/api/auth/email/request", { email: email.user.email }],
    [legacyEmailVerify, "/api/auth/email/verify", { email: email.user.email, challengeId: "cc".repeat(24), code: "123456" }],
  ] as const;
  for (const [handler, path, body] of attempts) {
    const result = await handler.POST(request(path, "POST", body));
    assert.equal(result.status, 409, path);
    assert.equal((await result.json()).code, "USE_PRIVY_LOGIN", path);
    assert.equal((await handler.POST(request(path, "POST", body, undefined, undefined, "https://attacker.example"))).status, 403, "origin checks still run first");
  }
  assert.deepEqual(await counters(), before, "blocked legacy calls must not write accounts, challenges, sessions or milestones");
  assert.equal(mailAttempts, 0, "the old email sender is not invoked even when its credentials are configured");
  assert.equal((await (await legacyEmailRequest.GET(request("/api/auth/email/request"))).json()).available, false);
  assert.equal((await legacyEmailSession.GET(new NextRequest(`${origin}/api/auth/email/session`, { headers: { Cookie: email.cookie } }))).status, 200);
  assert.equal((await legacyWalletSession.GET(new NextRequest(`${origin}/api/auth/session`, { headers: { Cookie: wallet.cookie } }))).status, 200);
});

test("an access-token-only login reads Privy's verified current user and restores an existing email reviewer's account", async () => {
  const previous = await legacyEmail(reviewerEmail);
  const privyDid = did();
  const tokens = await tokenPair({ privyDid });
  let currentCookie = previous.cookie;
  currentUserPlans.push({ body: currentUserBody(privyDid, [fullEmailAccount(reviewerEmail)]) });
  for (const identityToken of [undefined, null, ""]) {
    const incoming = request("/api/auth/privy/session", "POST", {
      accessToken: tokens.accessToken, identityToken,
      // The user can choose neither the upstream identity nor its privileges.
      email: "attacker@example.com", privyDid: did(), isAdmin: false,
      userEndpoint: "https://attacker.example/profile",
    });
    const separator = currentCookie.indexOf("=");
    incoming.cookies.set(currentCookie.slice(0, separator), currentCookie.slice(separator + 1));
    const response = await route.POST(incoming);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.user.id, previous.user.id);
    assert.equal(body.user.email, reviewerEmail);
    assert.equal(body.user.isAdmin, true);
    assert.deepEqual(body.user.walletAddresses, []);
    const token = response.headers.get("set-cookie")!.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)![1];
    currentCookie = `${cookieName}=${token}`;
    const reviewer = { user: body.user, cookie: currentCookie };
    assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, reviewer))).status, 200);
    assert.ok(Date.parse(body.expiresAt) <= (nowSeconds() + 3600) * 1000, "the fallback session cannot outlive its verified access token");
  }
  assert.equal(currentUserRequests.length, 1, "reloads with the same verified token reuse the short-lived profile snapshot");
  assert.ok(currentUserRequests.every((call) => call.headers.get("authorization") === `Bearer ${tokens.accessToken}`));
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.privySession.count(), 1);
  assert.equal(await db.emailSession.count(), 0);
  assert.equal(await db.testerProfile.count(), 1);
  assert.equal(await db.testerMilestone.count({ where: { kind: "SIGN_IN" } }), 1);
});

test("signed identity headers and SDK cookies verify sign-in without a provider profile request", async () => {
  const tokens = await tokenPair({ accounts: [emailAccount(reviewerEmail), walletAccount(ownerWallet)] });
  const { sub } = JSON.parse(Buffer.from(tokens.accessToken.split(".")[1], "base64url").toString());
  for (const source of ["cookie", "scoped-cookie", "header"] as const) {
    const incoming = request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken, identityToken: null });
    if (source === "header") incoming.headers.set("privy-id-token", tokens.identityToken);
    else incoming.cookies.set(source === "cookie" ? "privy-id-token" : `privy-${sub}-id-token`, tokens.identityToken);
    const response = await route.POST(incoming);
    assert.equal(response.status, 200, source);
    const body = await response.json();
    assert.equal(body.user.email, reviewerEmail);
    assert.equal(body.user.isAdmin, true);
    assert.deepEqual(body.user.walletAddresses, [ownerWallet]);
  }
  assert.equal(currentUserRequests.length, 0, "a signed identity proof bypasses the rate-limited profile endpoint");
  assert.equal(await db.user.count(), 1);
});

test("identity cookies cannot authenticate forged, expired, foreign-app or mismatched proofs", async () => {
  const tokens = await tokenPair();
  const invalidProofs = [
    "forged-identity-token",
    (await tokenPair({ identityClaims: { aud: "foreign-app" } })).identityToken,
    (await tokenPair({ identityClaims: { exp: nowSeconds() - 60 } })).identityToken,
    (await tokenPair()).identityToken,
  ];
  for (const proof of invalidProofs) {
    const incoming = request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken });
    incoming.cookies.set("privy-id-token", proof);
    const response = await route.POST(incoming);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "INVALID_PRIVY_TOKEN");
  }
  for (const source of ["body", "header"] as const) {
    const incoming = request("/api/auth/privy/session", "POST", {
      accessToken: tokens.accessToken, ...(source === "body" ? { identityToken: "invalid-explicit-token" } : {}),
    });
    incoming.cookies.set("privy-id-token", tokens.identityToken);
    if (source === "header") incoming.headers.set("privy-id-token", "invalid-explicit-token");
    assert.equal((await route.POST(incoming)).status, 401, "an invalid explicit proof cannot fall back to a valid cookie");
  }
  assert.equal(currentUserRequests.length, 0);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
});

test("a supplied invalid identity token cannot be replaced with a more permissive profile lookup", async () => {
  const tokens = await tokenPair({ accounts: [emailAccount(reviewerEmail)] });
  const invalid = await route.POST(request("/api/auth/privy/session", "POST", { ...tokens, identityToken: "invalid-token" }));
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).code, "INVALID_PRIVY_TOKEN");
  assert.equal(currentUserRequests.length, 0, "a failed signed identity proof never downgrades to the fallback");
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
  assert.equal((await adminQueue.GET(request("/api/admin/submissions"))).status, 401);
});

test("forged or foreign access tokens are rejected before any current-user API request", async () => {
  const badTokens = [
    "forged-access-token",
    (await tokenPair({ accessClaims: { aud: "foreign-app" } })).accessToken,
    (await tokenPair({ accessClaims: { iss: "attacker.example" } })).accessToken,
    (await tokenPair({ accessClaims: { exp: nowSeconds() - 120 } })).accessToken,
    (await tokenPair({ accessClaims: { sid: "" } })).accessToken,
  ];
  for (const accessToken of badTokens) {
    const response = await route.POST(request("/api/auth/privy/session", "POST", { accessToken, identityToken: null, email: reviewerEmail, isAdmin: true }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "INVALID_PRIVY_TOKEN");
  }
  assert.equal(currentUserRequests.length, 0);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
});

test("current-user profiles must match the cryptographically verified Privy DID", async () => {
  const tokens = await tokenPair();
  currentUserPlans.push({ body: currentUserBody(did(), [fullEmailAccount(reviewerEmail)]) });
  const response = await route.POST(request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken, identityToken: null }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "INVALID_PRIVY_TOKEN");
  assert.equal(currentUserRequests.length, 1);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
  assert.equal(await db.testerProfile.count(), 0);
});

test("unverified current-user contact fields never authorize a reviewer or attach an unrelated wallet", async () => {
  const privyDid = did();
  const tokens = await tokenPair({ privyDid });
  currentUserPlans.push({ body: currentUserBody(privyDid, [
    fullWalletAccount(ownerWallet),
    { type: "email", address: reviewerEmail },
    { type: "email", address: reviewerEmail, verified_at: 0, latest_verified_at: 0 },
    { type: "wallet", address: otherWallet, chain_type: "ethereum" },
  ]) });
  const response = await route.POST(request("/api/auth/privy/session", "POST", {
    accessToken: tokens.accessToken, identityToken: null, email: reviewerEmail, isAdmin: true,
    linked_accounts: [fullEmailAccount(reviewerEmail)],
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.email, null);
  assert.equal(body.user.isAdmin, false);
  assert.deepEqual(body.user.walletAddresses, [ownerWallet]);
  const token = response.headers.get("set-cookie")!.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)![1];
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, { user: body.user, cookie: `${cookieName}=${token}` }))).status, 403);
});

test("current-user authentication failures and provider outages fail closed without revoking a valid reviewer session", async () => {
  const signed = await login([emailAccount(reviewerEmail)]);
  const tokens = await tokenPair({ privyDid: signed.privyDid });
  const cases: Array<{ plan: CurrentUserPlan; status: number; code: string }> = [
    { plan: { status: 401 }, status: 401, code: "INVALID_PRIVY_TOKEN" },
    { plan: { status: 403 }, status: 401, code: "INVALID_PRIVY_TOKEN" },
    { plan: { status: 503 }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
    { plan: { failure: "network" }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
    { plan: { failure: "timeout" }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
    { plan: { raw: "{" }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
    { plan: { body: { user: null } }, status: 401, code: "INVALID_PRIVY_TOKEN" },
    { plan: { body: currentUserBody(signed.privyDid, []), headers: { "Content-Length": "1000000" } }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
    { plan: { raw: JSON.stringify({ ...currentUserBody(signed.privyDid, [fullEmailAccount(reviewerEmail)]), padding: "x".repeat(70_000) }) }, status: 503, code: "PRIVY_VERIFICATION_UNAVAILABLE" },
  ];
  for (const { plan, status, code } of cases) {
    currentUserPlans.push(plan);
    const response = await route.POST(request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken, identityToken: null }, signed));
    assert.equal(response.status, status, JSON.stringify(plan).slice(0, 200));
    assert.equal((await response.json()).code, code);
    assert.equal(await db.user.count(), 1);
    assert.equal(await db.privySession.count(), 1, "failed fallback cannot issue, rotate or revoke a session");
    assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed))).status, 200);
  }
  assert.equal(currentUserRequests.length, cases.length);
});

test("provider throttling forwards a bounded retry delay and preserves verified sessions", async () => {
  const signed = await login([emailAccount(reviewerEmail)]);
  const tokens = await tokenPair({ privyDid: signed.privyDid });
  for (const [header, expected] of [["45", "45"], [undefined, "30"], ["invalid", "30"], ["999999", "300"]] as const) {
    currentUserPlans.push({ status: 429, headers: header ? { "Retry-After": header } : {} });
    const response = await route.POST(request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken, identityToken: null }, signed));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), expected);
    assert.equal((await response.json()).code, "PRIVY_PROFILE_RATE_LIMITED");
    assert.equal(await db.privySession.count(), 1, "throttling cannot issue or revoke a session");
  }
});

test("verification service outages remain retryable and do not invalidate an existing verified reviewer cookie", async () => {
  const signed = await login([emailAccount(reviewerEmail)]);
  const originalAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const outageAppId = "clartiqprivyverificationoutage";
  const tokens = await tokenPair({
    privyDid: signed.privyDid, accounts: [emailAccount(reviewerEmail)],
    accessClaims: { aud: outageAppId }, identityClaims: { aud: outageAppId },
  });
  let response: Response;
  try {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = outageAppId;
    jwksFailureAppId = outageAppId;
    response = await route.POST(request("/api/auth/privy/session", "POST", tokens, signed));
  } finally {
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = originalAppId;
    jwksFailureAppId = null;
  }
  assert.equal(response!.status, 503);
  assert.equal((await response!.json()).code, "PRIVY_VERIFICATION_UNAVAILABLE");
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.privySession.count(), 1, "failed verification does not rotate or revoke a valid cookie");
  const restored = await route.GET(new NextRequest(`${origin}/api/auth/privy/session`, { headers: { Cookie: signed.cookie } }));
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).user.isAdmin, true);
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed))).status, 200);
});

test("server verification diagnostics identify provider failures without logging private credentials or profile data", async () => {
  const signed = await login([emailAccount(reviewerEmail)]);
  const tokens = await tokenPair({ privyDid: signed.privyDid });
  const privateDetails = `private-provider-payload:${reviewerEmail}:${signed.privyDid}:${tokens.accessToken}`;
  const cases: Array<{ plan: CurrentUserPlan; reason: string; upstreamStatus?: number; networkCode?: string }> = [
    { plan: { status: 503, body: { error: privateDetails } }, reason: "http-status", upstreamStatus: 503 },
    { plan: { failure: "network", networkCode: "ENOTFOUND", failureDetails: privateDetails }, reason: "network", networkCode: "ENOTFOUND" },
    { plan: { failure: "network", networkCode: privateDetails, failureDetails: privateDetails }, reason: "network" },
    { plan: { failure: "timeout", failureDetails: privateDetails }, reason: "timeout" },
    { plan: { raw: `{${JSON.stringify(privateDetails)}` }, reason: "invalid-json" },
    { plan: { body: { privateUnexpectedShape: privateDetails } }, reason: "invalid-profile" },
    { plan: { body: { privateUnexpectedShape: privateDetails }, headers: { "Content-Length": "1000000" } }, reason: "oversized" },
  ];
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  try {
    console.warn = (...values: unknown[]) => { warnings.push(values); };
    for (const { plan, reason, upstreamStatus, networkCode } of cases) {
      warnings.length = 0;
      currentUserPlans.push(plan);
      const response = await route.POST(request("/api/auth/privy/session", "POST", { accessToken: tokens.accessToken, identityToken: null }, signed));
      assert.equal(response.status, 503);
      const responseBody = await response.json();
      assert.equal(responseBody.code, "PRIVY_VERIFICATION_UNAVAILABLE");
      const failure = warnings.find((entry) => entry[0] === "[artiq-auth]" && entry[1] && typeof entry[1] === "object")?.[1] as Record<string, unknown> | undefined;
      assert.ok(failure, "a server-only diagnostic is emitted for this provider failure");
      assert.equal(failure.event, "privy_session_verification_failed");
      assert.equal(failure.code, "PRIVY_VERIFICATION_UNAVAILABLE");
      const diagnostic = failure.diagnostic && typeof failure.diagnostic === "object" ? failure.diagnostic as Record<string, unknown> : failure;
      assert.equal(diagnostic.stage, "current-user");
      assert.equal(diagnostic.reason, reason);
      assert.equal(diagnostic.upstreamStatus, upstreamStatus);
      assert.equal(diagnostic.networkCode, networkCode);
      assert.ok(typeof failure.elapsedMs === "number" && Number.isFinite(failure.elapsedMs) && failure.elapsedMs >= 0);
      assert.ok(Object.keys(diagnostic).every((key) => ["event", "code", "stage", "reason", "upstreamStatus", "networkCode", "elapsedMs"].includes(key)), "only bounded diagnostic fields may reach logs");
      assert.ok(!("stage" in responseBody) && !("networkCode" in responseBody), "operational diagnostics remain on the server");
      const output = JSON.stringify({ warnings, responseBody });
      for (const secret of [tokens.accessToken, tokens.identityToken, reviewerEmail, signed.privyDid, privateDetails]) {
        assert.ok(!output.includes(secret), "JWTs, verified identities and upstream messages must stay out of logs and responses");
      }
      assert.equal(await db.privySession.count(), 1);
      assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed))).status, 200);
    }
  } finally {
    console.warn = originalWarn;
  }
  const forgedDiagnostic = Object.assign(new Error(privateDetails), {
    stage: privateDetails, reason: privateDetails, diagnostic: { stage: privateDetails },
    cause: { code: privateDetails, message: privateDetails },
  });
  assert.deepEqual(auth.privyVerificationDiagnostic(forgedDiagnostic), { stage: "access-token", reason: "invalid-token" },
    "arbitrary error properties cannot inject data into the safe diagnostic output");
});

test("cryptographically verifies both tokens and rejects forged, expired or mismatched claims", async () => {
  const resolver = createLocalJWKSet({ keys: [publicJwk] });
  const valid = await tokenPair({ accounts: [emailAccount("verified@example.com")] });
  assert.equal((await auth.verifyPrivyTokens(valid, resolver)).email, "verified@example.com");
  const badPairs = [
    await tokenPair({ accessClaims: { aud: "another-app" } }),
    await tokenPair({ identityClaims: { aud: "another-app" } }),
    await tokenPair({ accessClaims: { iss: "attacker.example" } }),
    await tokenPair({ identityClaims: { iss: "attacker.example" } }),
    await tokenPair({ accessClaims: { exp: nowSeconds() - 120 } }),
    await tokenPair({ identityClaims: { exp: nowSeconds() - 120 } }),
    await tokenPair({ identityClaims: { sub: did() } }),
    await tokenPair({ accessClaims: { nbf: nowSeconds() + 300 } }),
    await tokenPair({ accessClaims: { sid: "" } }),
    await tokenPair({ accessClaims: { exp: undefined } }),
    await tokenPair({ identityClaims: { iat: nowSeconds() + 300 } }),
    await tokenPair({ identityClaims: { linked_accounts: [] } }),
  ];
  const foreignKey = await generateKeyPair("ES256");
  const forgedIdentity = await new SignJWT({ iss: "privy.io", aud: appId, sub: did(), exp: nowSeconds() + 3600, iat: nowSeconds(), linked_accounts: "[]" }).setProtectedHeader({ alg: "ES256", kid: "artiq-test-key" }).sign(foreignKey.privateKey);
  badPairs.push({ ...valid, identityToken: forgedIdentity });
  const wrongAlgorithm = await new SignJWT({ iss: "privy.io", aud: appId, sub: did(), exp: nowSeconds() + 3600, iat: nowSeconds() }).setProtectedHeader({ alg: "HS256", kid: "artiq-test-key" }).sign(randomBytes(32));
  badPairs.push({ ...valid, accessToken: wrongAlgorithm });
  for (const pair of badPairs) {
    await assert.rejects(auth.verifyPrivyTokens(pair, resolver));
    assert.equal((await route.POST(request("/api/auth/privy/session", "POST", pair))).status, 401);
  }
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.privySession.count(), 0);
});

test("accepts only verified linked email and Ethereum wallets from the signed identity token", async () => {
  const tokens = await tokenPair({ accounts: [
    { type: "email", address: "unverified@example.com" },
    { type: "email", address: "zero@example.com", lv: 0 },
    emailAccount("  Verified@Example.COM  "),
    walletAccount(ownerWallet), walletAccount(ownerWallet.toUpperCase().replace("0X", "0x")),
    walletAccount(otherWallet, { lv: undefined }),
    walletAccount(otherWallet, { user_can_sign: false }),
    walletAccount(reviewerWallet, { chain_type: "solana" }),
    { type: "google_oauth", email: "spoofed-admin@example.com", lv: nowSeconds() },
  ] });
  const result = await auth.verifyPrivyTokens(tokens, createLocalJWKSet({ keys: [publicJwk] }));
  assert.equal(result.email, "verified@example.com");
  assert.deepEqual(result.walletAddresses, [ownerWallet]);
  assert.ok(result.expiresAt.getTime() <= (nowSeconds() + 3600) * 1000);
});

test("creates one stable account, hashes its short session and ignores unsigned identity or role fields", async () => {
  const privyDid = did();
  const tokens = await tokenPair({ privyDid, accounts: [emailAccount("new@example.com"), walletAccount(ownerWallet)] });
  const response = await route.POST(request("/api/auth/privy/session", "POST", { ...tokens, email: reviewerEmail, privyId: did(), walletAddress: reviewerWallet, isAdmin: true }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.email, "new@example.com");
  assert.equal(body.user.isAdmin, false);
  const user = await db.user.findUniqueOrThrow({ where: { id: body.user.id } });
  assert.equal(user.privyId, privyDid);
  assert.equal(user.email, "new@example.com");
  assert.ok(user.emailVerifiedAt);
  const value = response.headers.get("set-cookie")!.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)![1];
  const persisted = await db.privySession.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(value).digest("hex") } });
  assert.equal(persisted.userId, user.id);
  assert.notEqual(persisted.tokenHash, value);
  assert.ok(persisted.expiresAt.getTime() <= Date.now() + 3600_000);
  assert.ok(!JSON.stringify(persisted).includes(tokens.accessToken));
  assert.ok(!JSON.stringify(persisted).includes(tokens.identityToken));
  const signed = await login([emailAccount("new@example.com"), walletAccount(ownerWallet)], { privyDid });
  assert.equal(signed.user.id, user.id);
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.testerProfile.count(), 1);
  assert.equal(await db.testerMilestone.count({ where: { kind: "SIGN_IN" } }), 1);
  const identity = await route.GET(request("/api/auth/privy/session", "GET", undefined, signed));
  assert.equal(identity.status, 200);
  assert.equal((await identity.json()).user.id, user.id);
});

test("simultaneous first sign-ins and a retry cannot duplicate an account or its sign-in milestone", async () => {
  const privyDid = did();
  const tokens = await tokenPair({ privyDid, accounts: [emailAccount("concurrent@example.com")] });
  const responses = await Promise.all([
    route.POST(request("/api/auth/privy/session", "POST", tokens)),
    route.POST(request("/api/auth/privy/session", "POST", tokens)),
  ]);
  assert.ok(responses.some((response) => response.status === 200));
  assert.ok(responses.every((response) => response.status === 200 || response.status === 503));
  const signed = await login([emailAccount("concurrent@example.com")], { privyDid });
  assert.equal((await db.user.findUniqueOrThrow({ where: { privyId: privyDid } })).id, signed.user.id);
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.testerProfile.count(), 1);
  assert.equal(await db.testerMilestone.count({ where: { kind: "SIGN_IN" } }), 1);
});

test("migrates verified email ownership and preserves creator data and existing tester points", async () => {
  const previous = await legacyEmail("returning@example.com");
  await board.awardTesterMilestone(db, previous.user.id, "APPROVED_CREATOR");
  const image = await db.uploadedImage.create({ data: { ownerUserId: previous.user.id, mimeType: "image/png", data: new Uint8Array(png) } });
  const item = await db.item.create({ data: { creatorId: previous.user.id, itemType: "NFT", title: "Existing work" } });
  const before = await board.getTesterEntry(previous.user.id);
  const signed = await login([emailAccount("returning@example.com")], { legacyCookie: previous.cookie });
  assert.equal(signed.user.id, previous.user.id);
  assert.equal(await db.user.count(), 1);
  assert.equal((await db.uploadedImage.findUniqueOrThrow({ where: { id: image.id } })).ownerUserId, previous.user.id);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).creatorId, previous.user.id);
  assert.equal((await board.getTesterEntry(previous.user.id))?.points, before?.points);
  assert.equal(await db.testerMilestone.count({ where: { kind: "SIGN_IN" } }), 1);
  assert.equal(await db.emailSession.count(), 0, "Privy replaces the presented legacy session");
});

test("an old unverified contact email cannot transfer ownership of its account", async () => {
  const old = await db.user.create({ data: { email: "contact-only@example.com", username: "Older artist" } });
  const image = await db.uploadedImage.create({ data: { ownerUserId: old.id, mimeType: "image/png", data: new Uint8Array(png) } });
  const signed = await login([emailAccount("contact-only@example.com")]);
  assert.notEqual(signed.user.id, old.id);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: old.id } })).privyId, null);
  assert.equal((await imageRoute.GET(request(`/api/uploads/${image.id}`, "GET", undefined, signed), { params: Promise.resolve({ id: image.id }) })).status, 404);
  assert.equal(await db.user.count(), 2);
});

test("migrates an external wallet account without changing its identity or duplicating its profile", async () => {
  const previous = await legacyWallet(ownerWallet);
  const signed = await login([walletAccount(ownerWallet)], { legacyCookie: previous.cookie });
  assert.equal(signed.user.id, previous.user.id);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: previous.user.id } })).walletAddress, ownerWallet);
  assert.equal(await db.user.count(), 1);
  assert.equal(await db.testerProfile.count(), 1);
  assert.equal(await db.walletSession.count(), 0);
});

test("requires an owned account choice when email and wallet belong to different existing accounts", async () => {
  const email = await legacyEmail("separate@example.com");
  const wallet = await legacyWallet(ownerWallet);
  const attacker = await db.user.create({ data: { email: "unrelated@example.com", emailVerifiedAt: new Date() } });
  const privyDid = did();
  const tokens = await tokenPair({ privyDid, accounts: [emailAccount(email.user.email!), walletAccount(ownerWallet)] });
  const result = await route.POST(request("/api/auth/privy/session", "POST", tokens));
  assert.equal(result.status, 409);
  const choices = await result.json();
  assert.equal(choices.code, "ACCOUNT_SELECTION_REQUIRED");
  assert.deepEqual(choices.accounts.map((entry: { id: string }) => entry.id).sort(), [email.user.id, wallet.user.id].sort());
  assert.ok(!JSON.stringify(choices).includes(email.user.email!), "the account picker does not expose private email");
  assert.equal(await db.privySession.count(), 0);
  assert.equal(await db.user.count({ where: { privyId: { not: null } } }), 0);
  assert.equal((await route.POST(request("/api/auth/privy/session", "POST", { ...tokens, preferredAccountId: attacker.id }))).status, 409);
  const signed = await login([emailAccount(email.user.email!), walletAccount(ownerWallet)], { privyDid, preferredAccountId: email.user.id });
  assert.equal(signed.user.id, email.user.id);
  assert.equal(await db.user.count(), 3, "separate account histories are never silently merged");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: wallet.user.id } })).privyId, null);
  const rebind = await route.POST(request("/api/auth/privy/session", "POST", { ...tokens, preferredAccountId: wallet.user.id }));
  assert.equal(rebind.status, 409, "a later account-selection hint cannot rebind an existing DID");
  assert.equal((await db.user.findUniqueOrThrow({ where: { privyId: privyDid } })).id, email.user.id);
});

test("a valid legacy proof selects its own candidate and a different DID cannot steal a bound account", async () => {
  const email = await legacyEmail("legacy-choice@example.com");
  const wallet = await legacyWallet(ownerWallet);
  const signed = await login([emailAccount(email.user.email!), walletAccount(ownerWallet)], { legacyCookie: wallet.cookie });
  assert.equal(signed.user.id, wallet.user.id);
  const takeover = await route.POST(request("/api/auth/privy/session", "POST", { ...await tokenPair({ accounts: [walletAccount(ownerWallet)] }), preferredAccountId: wallet.user.id }));
  assert.equal(takeover.status, 409);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: wallet.user.id } })).privyId, signed.privyDid);
  assert.equal(await db.user.count(), 2);
});

test("protects private uploads and applications with the stable account ID and rejects body impersonation", async () => {
  const owner = await login([emailAccount("owner@example.com"), walletAccount(ownerWallet)]);
  const other = await login([emailAccount("other@example.com")]);
  const form = new FormData();
  form.set("file", new File([png], "nft.png", { type: "image/png" }));
  const uploaded = await uploads.POST(new NextRequest(`${origin}/api/uploads`, { method: "POST", headers: { Origin: origin, Cookie: owner.cookie, "X-Artiq-Account-ID": owner.user.id }, body: form }));
  assert.equal(uploaded.status, 201);
  const { url } = await uploaded.json();
  const imageId = url.split("/").pop();
  assert.equal((await db.uploadedImage.findUniqueOrThrow({ where: { id: imageId } })).ownerUserId, owner.user.id);
  const imageRequest = request(url, "GET", undefined, owner);
  imageRequest.headers.delete("x-artiq-account-id");
  assert.equal((await imageRoute.GET(imageRequest, { params: Promise.resolve({ id: imageId }) })).status, 200);
  assert.equal((await imageRoute.GET(request(url, "GET", undefined, other), { params: Promise.resolve({ id: imageId }) })).status, 404);
  assert.equal((await imageRoute.GET(request(url), { params: Promise.resolve({ id: imageId }) })).status, 404);
  const application = { itemType: "NFT", creationMethod: "AI_GENERATED", creatorName: "Privy artist", title: "Privy NFT", description: "A work submitted through verified Privy authentication.", imageUrl: url, priceUsdc: "2", maxSupply: 10, creatorId: other.user.id, email: other.user.email, walletAddress: reviewerWallet, isAdmin: true };
  const missingHeader = request("/api/submissions", "POST", application, owner);
  missingHeader.headers.delete("x-artiq-account-id");
  assert.equal((await submissions.POST(missingHeader)).status, 401);
  const wrongHeader = request("/api/submissions", "POST", application, owner);
  wrongHeader.headers.set("x-artiq-account-id", other.user.id);
  assert.equal((await submissions.POST(wrongHeader)).status, 401);
  assert.equal((await submissions.POST(request("/api/submissions", "POST", application, other))).status, 400);
  const created = await submissions.POST(request("/api/submissions", "POST", application, owner));
  assert.equal(created.status, 201);
  const saved = (await created.json()).submission;
  assert.equal(saved.creatorId, owner.user.id);
  assert.equal(saved.status, "APPROVED");
  assert.ok(saved.itemId);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: saved.itemId } })).contractAddress, null, "publishing setup does not bypass paid on-chain creation");
  assert.equal((await (await submissions.GET(request("/api/submissions", "GET", undefined, other))).json()).submissions.length, 0);
  assert.equal((await (await submissions.GET(request("/api/submissions", "GET", undefined, owner))).json()).submissions.length, 1);
});

test("a verified allowlisted email reviews private applications without connecting a wallet", async () => {
  const original = process.env.ARTIQ_ADMIN_EMAILS;
  process.env.ARTIQ_ADMIN_EMAILS = "invalid,  REVIEWER@Example.COM , other-reviewer@example.com";
  let signed: Login;
  try { signed = await login([emailAccount("  Reviewer@Example.COM  ")]); }
  finally { process.env.ARTIQ_ADMIN_EMAILS = original; }
  assert.equal(signed.user.isAdmin, true);
  assert.equal(signed.user.email, reviewerEmail);
  assert.equal(signed.user.walletAddress, null);
  assert.deepEqual(signed.user.walletAddresses, []);
  const privateOwner = await db.user.create({ data: { email: "private-image-owner@example.com", emailVerifiedAt: new Date() } });
  const image = await db.uploadedImage.create({ data: { ownerUserId: privateOwner.id, mimeType: "image/png", data: new Uint8Array(png) } });
  const imagePath = `/api/uploads/${image.id}`;
  const headerlessSession = await route.GET(new NextRequest(`${origin}/api/auth/privy/session`, { headers: { Cookie: signed.cookie } }));
  assert.equal(headerlessSession.status, 200);
  assert.equal((await headerlessSession.json()).user.isAdmin, true);
  const reviewerImage = await imageRoute.GET(new NextRequest(`${origin}${imagePath}`, { headers: { Cookie: signed.cookie } }), { params: Promise.resolve({ id: image.id }) });
  assert.equal(reviewerImage.status, 200, "browser image requests authenticate the verified reviewer email through its HttpOnly cookie");
  assert.equal(reviewerImage.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await reviewerImage.arrayBuffer()), png);
  const unbound = request("/api/admin/submissions", "GET", undefined, signed);
  unbound.headers.delete("x-artiq-account-id");
  assert.equal((await adminQueue.GET(unbound)).status, 401, "review APIs require the authenticated account ID");
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed, reviewerWallet))).status, 401, "an arbitrary wallet header cannot be attached to an email-only account");
  const queue = await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed));
  assert.equal(queue.status, 200);
  assert.equal(queue.headers.get("cache-control"), "private, no-store");
  const accountSpoof = request("/api/admin/submissions", "GET", undefined, signed);
  accountSpoof.headers.set("x-artiq-account-id", "different-account");
  assert.equal((await adminQueue.GET(accountSpoof)).status, 401);
  const pending = await db.submission.create({ data: { creatorId: privateOwner.id, itemType: "NFT", creationMethod: "AI_GENERATED", creatorName: "Artist", title: "Email-reviewed NFT", description: "A collection reviewed with an email account.", imageUrl: imagePath, priceUsdc: 1, maxSupply: 5, nftKind: "COLLECTIBLE" } });
  const foreign = request(`/api/admin/submissions/${pending.id}`, "PATCH", { decision: "APPROVED" }, signed, undefined, "https://attacker.example");
  assert.equal((await reviewRoute.PATCH(foreign, { params: Promise.resolve({ id: pending.id }) })).status, 403);
  assert.equal(await db.item.count(), 0);
  const approved = await reviewRoute.PATCH(request(`/api/admin/submissions/${pending.id}`, "PATCH", { decision: "APPROVED", reviewedBy: "spoofed-reviewer", email: "claimed@example.com" }, signed), { params: Promise.resolve({ id: pending.id }) });
  assert.equal(approved.status, 200);
  const reviewed = await db.submission.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(reviewed.status, "APPROVED");
  assert.equal(reviewed.reviewedBy, `user:${signed.user.id}`);
  assert.ok(reviewed.itemId);
  assert.equal((await reviewRoute.PATCH(request(`/api/admin/submissions/${pending.id}`, "PATCH", { decision: "APPROVED" }, signed), { params: Promise.resolve({ id: pending.id }) })).status, 409);
  assert.equal(await db.item.count(), 1, "repeat review cannot publish a duplicate listing");
  const rejected = await db.submission.create({ data: { creatorId: privateOwner.id, creatorName: "Artist", itemType: "NFT", title: "Rejected NFT", description: "An application requiring revised details.", imageUrl: imagePath, priceUsdc: 1, maxSupply: 5 } });
  assert.equal((await reviewRoute.PATCH(request(`/api/admin/submissions/${rejected.id}`, "PATCH", { decision: "REJECTED" }, signed), { params: Promise.resolve({ id: rejected.id }) })).status, 400);
  assert.equal((await reviewRoute.PATCH(request(`/api/admin/submissions/${rejected.id}`, "PATCH", { decision: "REJECTED", reviewNote: "Please provide clearer ownership details." }, signed), { params: Promise.resolve({ id: rejected.id }) })).status, 200);
  assert.equal((await db.submission.findUniqueOrThrow({ where: { id: rejected.id } })).reviewedBy, `user:${signed.user.id}`);
  assert.equal(await db.item.count(), 1, "rejection does not publish artwork");
});

test("a stale browser wallet cannot block email reviewer bootstrap or grant unlinked wallet access", async () => {
  const signed = await login([emailAccount(reviewerEmail)]);
  const before = {
    userCount: await db.user.count(),
    profileCount: await db.testerProfile.count(),
    milestoneCount: await db.testerMilestone.count(),
  };
  const tokens = await tokenPair({ privyDid: signed.privyDid, accounts: [emailAccount(reviewerEmail)] });
  const staleWallet = await route.POST(request("/api/auth/privy/session", "POST", tokens, signed, otherWallet));
  assert.equal(staleWallet.status, 200, "a wallet left connected from a different identity must not block proven email sign-in");
  const body = await staleWallet.json();
  assert.equal(body.user.id, signed.user.id);
  assert.equal(body.user.isAdmin, true);
  assert.equal(body.user.walletAddress, null);
  assert.deepEqual(body.user.walletAddresses, [], "an unlinked browser wallet never becomes a verified account wallet");
  const token = staleWallet.headers.get("set-cookie")!.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)![1];
  const restored = { ...signed, cookie: `${cookieName}=${token}` };
  const cookieOnly = new NextRequest(`${origin}/api/auth/privy/session`, { headers: { Cookie: restored.cookie } });
  const snapshot = await route.GET(cookieOnly);
  assert.equal(snapshot.status, 200, "page reload can read its own verified HttpOnly session without a wallet header");
  assert.equal((await snapshot.json()).user.isAdmin, true);
  const staleBootstrap = await route.GET(request("/api/auth/privy/session", "GET", undefined, restored, otherWallet));
  assert.equal(staleBootstrap.status, 200, "a stale wallet does not erase the current email session during restoration");
  const staleBody = await staleBootstrap.json();
  assert.equal(staleBody.user.isAdmin, true);
  assert.deepEqual(staleBody.user.walletAddresses, []);
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, restored, otherWallet))).status, 401,
    "private APIs still reject an unlinked wallet header even after successful bootstrap");
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, restored))).status, 200);
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, signed))).status, 401,
    "successful refresh rotates the previous session");
  assert.deepEqual({
    userCount: await db.user.count(),
    profileCount: await db.testerProfile.count(),
    milestoneCount: await db.testerMilestone.count(),
  }, before, "refresh and restoration cannot create duplicate accounts or tester credit");
});

test("wallet grants, unverified emails, contact fields and lookalike addresses never authorize a reviewer", async () => {
  const privateOwner = await db.user.create({ data: { email: "private-owner@example.com", emailVerifiedAt: new Date() } });
  const image = await db.uploadedImage.create({ data: { ownerUserId: privateOwner.id, mimeType: "image/png", data: new Uint8Array(png) } });
  for (const accounts of [
    [walletAccount(reviewerWallet)],
    [emailAccount(`${reviewerEmail}.attacker.invalid`)],
    [emailAccount("reviewer+claimed@example.com")],
    [emailAccount("not-reviewer@example.com")],
    [walletAccount(ownerWallet), { type: "email", address: reviewerEmail }],
    [walletAccount(otherWallet), { type: "email", address: reviewerEmail, lv: 0 }],
  ]) {
    const signed = await login(accounts);
    assert.equal(signed.user.isAdmin, false);
    assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed))).status, 403);
    assert.equal((await imageRoute.GET(new NextRequest(`${origin}/api/uploads/${image.id}`, { headers: { Cookie: signed.cookie } }), { params: Promise.resolve({ id: image.id }) })).status, 404);
  }
  const contactOwner = await db.user.findUniqueOrThrow({ where: { walletAddress: reviewerWallet } });
  await db.user.update({ where: { id: contactOwner.id }, data: { email: reviewerEmail, emailVerifiedAt: new Date() } });
  const contactTokens = await tokenPair({ privyDid: contactOwner.privyId!, accounts: [walletAccount(reviewerWallet)] });
  const contactResponse = await route.POST(request("/api/auth/privy/session", "POST", { ...contactTokens, email: reviewerEmail, contactEmail: reviewerEmail, isAdmin: true }));
  assert.equal(contactResponse.status, 200);
  assert.equal((await contactResponse.json()).user.isAdmin, false, "a stored profile/contact email is not a verified email in the current signed identity");
});

test("removing a reviewer email immediately revokes an existing session, including private image access", async () => {
  const signed = await login([emailAccount(reviewerEmail), walletAccount(ownerWallet)]);
  assert.equal(signed.user.isAdmin, true);
  const owner = await db.user.create({ data: { email: "image-owner@example.com", emailVerifiedAt: new Date() } });
  const image = await db.uploadedImage.create({ data: { ownerUserId: owner.id, mimeType: "image/png", data: new Uint8Array(png) } });
  const previous = process.env.ARTIQ_ADMIN_EMAILS;
  try {
    delete process.env.ARTIQ_ADMIN_EMAILS;
    const refreshed = await route.GET(request("/api/auth/privy/session", "GET", undefined, signed));
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).user.isAdmin, false);
    assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, signed))).status, 403);
    assert.equal((await imageRoute.GET(new NextRequest(`${origin}/api/uploads/${image.id}`, { headers: { Cookie: signed.cookie } }), { params: Promise.resolve({ id: image.id }) })).status, 404);
  } finally { process.env.ARTIQ_ADMIN_EMAILS = previous; }
  const unlinked = await login([walletAccount(ownerWallet)], { privyDid: signed.privyDid, legacyCookie: signed.cookie });
  assert.equal(unlinked.user.id, signed.user.id);
  assert.equal(unlinked.user.isAdmin, false, "an email removed from the signed identity cannot retain reviewer privileges through stored account data");
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, unlinked))).status, 403);
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, signed))).status, 401, "identity refresh revokes the previous signed session");
});

test("credits only transactions from verified linked wallets and never accepts unlinked receipt claims", async () => {
  const signed = await login([emailAccount("receipts@example.com"), walletAccount(ownerWallet)]);
  const foreignHash = artReceipt(otherWallet);
  assert.equal((await activityRoute.POST(request("/api/tester/activity", "POST", { txHash: foreignHash, kind: "BUY_ART" }, signed, ownerWallet))).status, 403);
  const unlinkedSelection = request("/api/tester/activity", "POST", { txHash: foreignHash, kind: "BUY_ART" }, signed, otherWallet);
  assert.equal((await activityRoute.POST(unlinkedSelection)).status, 401);
  const ownHash = artReceipt(ownerWallet);
  const result = await activityRoute.POST(request("/api/tester/activity", "POST", { txHash: ownHash, kind: "BUY_ART", points: 9_999_999 }, signed, ownerWallet));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).recorded, true);
  assert.equal(await db.testerMilestone.count({ where: { kind: "BUY_ART" } }), 1);
  const repeated = await activityRoute.POST(request("/api/tester/activity", "POST", { txHash: ownHash, kind: "BUY_ART" }, signed, ownerWallet));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).recorded, false);
  assert.equal(await db.testerMilestone.count({ where: { kind: "BUY_ART" } }), 1);
  assert.ok(rpcReads > 0, "receipt checks use the in-process verifier fixture");
});

test("invalid or expired Privy cookies fail closed even when a legacy reviewer cookie is present", async () => {
  const legacy = await legacyEmail(reviewerEmail);
  const forged = { user: { ...legacy.user, walletAddresses: [], authMethod: "PRIVY", isAdmin: true } as PublicUser, cookie: `${cookieName}=${"ff".repeat(32)}; ${legacy.cookie}` };
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, forged))).status, 401);
  assert.equal((await submissions.GET(request("/api/submissions", "GET", undefined, forged, reviewerWallet))).status, 401);
  assert.equal((await adminQueue.GET(request("/api/admin/submissions", "GET", undefined, forged, reviewerWallet))).status, 401);
  const signed = await login([emailAccount("expired@example.com")]);
  await db.privySession.updateMany({ where: { userId: signed.user.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, signed))).status, 401);
  assert.equal((await submissions.GET(request("/api/submissions", "GET", undefined, { ...signed, cookie: `${signed.cookie}; ${legacy.cookie}` }, reviewerWallet))).status, 401);
});

test("uses secure production cookies, respects the earliest JWT expiry and revokes sessions on same-origin logout", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const tokens = await tokenPair({ accounts: [emailAccount("short-session@example.com")], accessClaims: { exp: nowSeconds() + 900 }, identityClaims: { exp: nowSeconds() + 600 } });
  let signed: Login;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    const response = await route.POST(request("/api/auth/privy/session", "POST", tokens));
    assert.equal(response.status, 200);
    const body = await response.json();
    const cookie = response.headers.get("set-cookie")!;
    assert.ok(cookie.includes("Secure"));
    assert.ok(cookie.includes("HttpOnly"));
    assert.ok(cookie.includes("SameSite=lax"));
    const value = cookie.match(/(?:^|,\s*)artiq_privy_session=([^;,]+)/)![1];
    signed = { ...body, cookie: `${cookieName}=${value}`, privyDid: "unused" };
    assert.ok(Date.parse(body.expiresAt) <= (nowSeconds() + 600) * 1000);
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
  }
  const foreign = request("/api/auth/privy/session", "DELETE", undefined, signed!, undefined, "https://attacker.example");
  assert.equal((await route.DELETE(foreign)).status, 403);
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, signed!))).status, 200);
  const deleted = await route.DELETE(request("/api/auth/privy/session", "DELETE", undefined, signed!));
  assert.equal(deleted.status, 200);
  assert.ok(deleted.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.equal((await route.GET(request("/api/auth/privy/session", "GET", undefined, signed!))).status, 401);
  assert.equal(await db.privySession.count(), 0);
  assert.ok(fetchedUrls.length > 0, "actual route token verification loaded the stubbed official JWKS endpoint");
});

test("anonymous logout clears cookies without opening a database transaction", async () => {
  const transaction = db.$transaction;
  Object.assign(db, { $transaction: () => { throw new Error("Anonymous logout must not access the database"); } });
  try {
    const response = await route.DELETE(request("/api/auth/privy/session", "DELETE"));
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("set-cookie")?.includes("Max-Age=0"));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await route.DELETE(request("/api/auth/privy/session", "DELETE", undefined, undefined, undefined, "https://attacker.example"))).status, 403);
  } finally { Object.assign(db, { $transaction: transaction }); }
});

test("security metrics are private to reviewers and contain aggregates only", async () => {
  const metrics = await import("../../app/api/admin/security/route");
  const anonymous = await metrics.GET(request("/api/admin/security"));
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
  const member = await login([emailAccount("member-metrics@example.com")]);
  assert.equal((await metrics.GET(request("/api/admin/security", "GET", undefined, member))).status, 403);
  const reviewer = await login([emailAccount(reviewerEmail)]);
  const response = await metrics.GET(request("/api/admin/security", "GET", undefined, reviewer));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.windowMinutes, 60);
  assert.equal(body.scope, "instance");
  assert.ok(body.totals.requests > 0);
  for (const privateValue of [reviewerEmail, "member-metrics@example.com", reviewer.user.id, reviewer.cookie]) {
    assert.ok(!JSON.stringify(body).includes(privateValue));
  }
});

test("verified login subjects are gated before any provider profile lookup", async () => {
  const did = "did:privy:pre-provider-limit";
  const tokens = await tokenPair({ privyDid: did });
  const denied = new Error("ACCOUNT_AT_CAPACITY");
  let checked = 0;
  const before = fetchedUrls.filter((url) => url.includes("/users/me")).length;
  await assert.rejects(() => auth.verifyPrivyTokens({ accessToken: tokens.accessToken }, undefined, async (subject) => {
    assert.equal(subject, did);
    checked++;
    throw denied;
  }), (error) => error === denied);
  assert.equal(checked, 1);
  assert.equal(fetchedUrls.filter((url) => url.includes("/users/me")).length, before);
  const forged = await tokenPair({ accessClaims: { aud: "foreign-app" } });
  await assert.rejects(() => auth.verifyPrivyTokens({ accessToken: forged.accessToken }, undefined, async () => { checked++; }));
  assert.equal(checked, 1, "unverified subjects never enter the account gate");
});
