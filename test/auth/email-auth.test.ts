import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";

// Mail is captured only in this isolated test process. The application never
// receives a test delivery mode or an endpoint that exposes sign-in codes.
const directory = mkdtempSync(join(tmpdir(), "artiq-email-auth-"));
const origin = "http://localhost:3000";
const reviewerWallet = "0x2222222222222222222222222222222222222222";
process.env.DATABASE_URL = `file:${join(directory, "auth.db")}`;
process.env.ARTIQ_APP_ORIGIN = origin;
process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
process.env.ARTIQ_ADMIN_WALLETS = reviewerWallet;
process.env.GMAIL_SMTP_USER = "test.sender@gmail.com";
process.env.GMAIL_SMTP_APP_PASSWORD = "abcdefghijklmnop";
process.env.ARTIQ_EMAIL_CODE_SECRET = "01".repeat(32);

let db: typeof import("../../lib/prisma")["prisma"];
let requestRoute: typeof import("../../app/api/auth/email/request/route");
let verifyRoute: typeof import("../../app/api/auth/email/verify/route");
let sessionRoute: typeof import("../../app/api/auth/email/session/route");
let submissions: typeof import("../../app/api/submissions/route");
let uploads: typeof import("../../app/api/uploads/route");
let imageRoute: typeof import("../../app/api/uploads/[id]/route");
let adminQueue: typeof import("../../app/api/admin/submissions/route");
let reviewRoute: typeof import("../../app/api/admin/submissions/[id]/route");
let catalog: typeof import("../../app/api/items/route");
let walletSessionRoute: typeof import("../../app/api/auth/session/route");
let restoreMailer: (() => void) | undefined;
let failDelivery = false;
const deliveries: Array<{ email: string; code: string }> = [];

type EmailUser = { id: string; email: string };
type Challenge = { challengeId: string; email: string; expiresAt: string; resendAfter: number; code: string };
type Login = { user: EmailUser; cookie: string };

function request(endpoint: string, method = "GET", body?: unknown, login?: Login, browserOrigin = origin, requestOrigin = origin) {
  return new NextRequest(`${requestOrigin}${endpoint}`, {
    method,
    headers: {
      Origin: browserOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(login ? { Cookie: login.cookie, "X-Artiq-Account-ID": login.user.id } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function challenge(email: string): Promise<Challenge> {
  const response = await requestRoute.POST(request("/api/auth/email/request", "POST", { email }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["challengeId", "email", "expiresAt", "resendAfter"]);
  assert.equal(body.email, email.trim().toLowerCase());
  assert.equal(body.resendAfter, 60);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
  const delivery = deliveries.findLast((entry) => entry.email === body.email);
  assert.ok(delivery, "the code is delivered through SMTP, never the API response");
  return { ...body, code: delivery.code };
}

function verify(input: Challenge, changes: Record<string, unknown> = {}, browserOrigin = origin, requestOrigin = origin) {
  return verifyRoute.POST(request("/api/auth/email/verify", "POST", {
    email: input.email, challengeId: input.challengeId, code: input.code, ...changes,
  }, undefined, browserOrigin, requestOrigin));
}

async function login(email: string): Promise<Login> {
  const input = await challenge(email);
  const response = await verify(input);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.isAuthenticated, true);
  assert.deepEqual(Object.keys(body.user).sort(), ["email", "id"]);
  assert.equal(body.user.email, input.email);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.ok(cookie.startsWith("artiq_email_session="));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("SameSite=lax"));
  return { user: body.user, cookie: cookie.split(";")[0] };
}

before(async () => {
  writeFileSync(join(directory, "auth.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  // Nodemailer exposes distinct ESM and CommonJS entry points. Cover both so
  // tsx and Next's module loaders always use this in-memory transport.
  const mailers = Array.from(new Set([
    (await import("nodemailer")).default,
    createRequire(join(process.cwd(), "package.json"))("nodemailer").default as typeof import("nodemailer"),
  ]));
  const originals = mailers.map((mailer) => mailer.createTransport);
  for (const mailer of mailers) Object.assign(mailer, {
    createTransport: () => ({
      sendMail: async (mail: { to: { address: string }; text?: string }) => {
        const code = mail.text?.match(/\b\d{6}\b/)?.[0];
        assert.ok(code, "the email must contain its six-digit sign-in code");
        deliveries.push({ email: mail.to.address.toLowerCase(), code });
        if (failDelivery) throw new Error("Fake SMTP delivery failure; no external network request was made.");
        return { accepted: [mail.to.address], rejected: [] };
      },
      close: () => undefined,
    }),
  });
  restoreMailer = () => mailers.forEach((mailer, index) => Object.assign(mailer, { createTransport: originals[index] }));
  ({ prisma: db } = await import("../../lib/prisma"));
  [requestRoute, verifyRoute, sessionRoute, submissions, uploads, imageRoute, adminQueue, reviewRoute, catalog, walletSessionRoute] = await Promise.all([
    import("../../app/api/auth/email/request/route"),
    import("../../app/api/auth/email/verify/route"),
    import("../../app/api/auth/email/session/route"),
    import("../../app/api/submissions/route"),
    import("../../app/api/uploads/route"),
    import("../../app/api/uploads/[id]/route"),
    import("../../app/api/admin/submissions/route"),
    import("../../app/api/admin/submissions/[id]/route"),
    import("../../app/api/items/route"),
    import("../../app/api/auth/session/route"),
  ]);
});

after(async () => {
  restoreMailer?.();
  await db?.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

test("rejects foreign or missing origins, malformed input, and oversized bodies before sending mail", async () => {
  const sent = deliveries.length;
  const foreign = request("/api/auth/email/request", "POST", { email: "foreign@example.com" }, undefined, "https://attacker.example");
  foreign.headers.set("host", "attacker.example");
  foreign.headers.set("x-forwarded-host", "attacker.example");
  assert.equal((await requestRoute.POST(foreign)).status, 403);
  const noOrigin = request("/api/auth/email/request", "POST", { email: "missing@example.com" });
  noOrigin.headers.delete("origin");
  assert.equal((await requestRoute.POST(noOrigin)).status, 403);
  for (const email of ["invalid", "mail\r\nBcc: attacker@example.com", "a@", "x".repeat(260) + "@example.com"]) {
    assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email }))).status, 400);
  }
  assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "oversized@example.com", extra: "x".repeat(5000) }))).status, 400);
  assert.equal((await verifyRoute.POST(request("/api/auth/email/verify", "POST", { email: "valid@example.com", challengeId: "invalid", code: "12345" }))).status, 400);
  assert.equal(deliveries.length, sent);
});

test("normalizes email, verifies signup, stores hashes, and requires a new code to sign in again", async () => {
  const signed = await challenge("  New.Creator@Example.COM  ");
  const persisted = await db.emailChallenge.findUniqueOrThrow({ where: { id: signed.challengeId } });
  assert.equal(persisted.email, "new.creator@example.com");
  assert.equal(persisted.delivered, true);
  assert.match(persisted.codeHash, /^[a-f0-9]{64}$/);
  assert.notEqual(persisted.codeHash, signed.code);
  assert.ok(persisted.expiresAt.getTime() - persisted.createdAt.getTime() <= 10 * 60_000 + 1000);
  assert.equal(await db.user.findUnique({ where: { email: signed.email } }), null, "requesting a code alone does not create an account");

  const response = await verify(signed, { walletAddress: reviewerWallet, isAdmin: true });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.isAuthenticated, true);
  assert.deepEqual(Object.keys(body.user).sort(), ["email", "id"]);
  const user = await db.user.findUniqueOrThrow({ where: { id: body.user.id } });
  assert.equal(user.email, signed.email);
  assert.equal(user.walletAddress, null, "email accounts do not receive a fake blockchain address");
  assert.ok(user.emailVerifiedAt);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const token = cookie.split("=")[1];
  const session = await db.emailSession.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
  assert.equal(session.userId, user.id);
  assert.notEqual(session.tokenHash, token);
  assert.ok((await db.emailChallenge.findUniqueOrThrow({ where: { id: signed.challengeId } })).consumedAt);
  assert.equal((await verify(signed)).status, 400, "codes can only be consumed once");

  const identity = { user: body.user, cookie };
  const sessionResponse = await sessionRoute.GET(request("/api/auth/email/session", "GET", undefined, identity));
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual((await sessionResponse.json()).user, body.user);
  await db.emailChallenge.update({ where: { id: signed.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const secondLogin = await login(signed.email);
  assert.equal(secondLogin.user.id, user.id, "subsequent sign-in preserves the account");
  assert.equal(await db.user.count({ where: { email: signed.email } }), 1);
});

test("rejects wrong email, expired challenges, and five failed guesses without consuming valid identities", async () => {
  const signed = await challenge("wrong-code@example.com");
  assert.equal((await verify(signed, { email: "another@example.com" })).status, 400);
  const wrong = signed.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await verify(signed, { code: wrong })).status, 400);
  assert.equal((await verify(signed)).status, 400, "a locked challenge cannot be rescued by guessing its correct code");
  assert.equal(await db.user.findUnique({ where: { email: signed.email } }), null);
  assert.equal((await db.emailChallenge.findUniqueOrThrow({ where: { id: signed.challengeId } })).attempts, 5);

  const expired = await challenge("expired@example.com");
  await db.emailChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await verify(expired)).status, 400);
  assert.equal(await db.user.findUnique({ where: { email: expired.email } }), null);
});

test("binds codes to the configured public origin and ignores forwarded host claims", async () => {
  const previous = process.env.ARTIQ_APP_ORIGIN;
  try {
    process.env.ARTIQ_APP_ORIGIN = "https://artiq.example";
    const response = await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "public-origin@example.com" }, undefined, "https://artiq.example"));
    assert.equal(response.status, 200, "an explicitly configured tunnel origin is accepted through localhost");
    const body = await response.json();
    const signed = { ...body, code: deliveries.findLast((entry) => entry.email === body.email)!.code };
    assert.equal((await db.emailChallenge.findUniqueOrThrow({ where: { id: signed.challengeId } })).origin, "https://artiq.example");
    assert.equal((await verify(signed)).status, 400, "a challenge cannot cross from public origin to native origin");
    const attack = request("/api/auth/email/verify", "POST", signed, undefined, "https://evil.example");
    attack.headers.set("x-forwarded-host", "artiq.example");
    attack.headers.set("x-forwarded-proto", "https");
    assert.equal((await verifyRoute.POST(attack)).status, 403);
    assert.equal((await verify(signed, {}, "https://artiq.example")).status, 200);
  } finally {
    if (previous === undefined) delete process.env.ARTIQ_APP_ORIGIN;
    else process.env.ARTIQ_APP_ORIGIN = previous;
  }
});

test("concurrent verification consumes a code once and creates only one session", async () => {
  const signed = await challenge("concurrent@example.com");
  const count = await db.emailSession.count();
  const responses = await Promise.all([verify(signed), verify(signed)]);
  assert.equal(responses.filter((response) => response.status === 200).length, 1);
  assert.equal(responses.filter((response) => response.status === 400).length, 1);
  assert.equal(await db.emailSession.count(), count + 1);
  assert.equal(await db.user.count({ where: { email: signed.email } }), 1);
});

test("a successfully delivered resend invalidates the older pending code", async () => {
  const older = await challenge("resend-success@example.com");
  await db.emailChallenge.update({ where: { id: older.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
  const newer = await challenge(older.email);
  assert.notEqual(newer.challengeId, older.challengeId);
  assert.ok((await db.emailChallenge.findUniqueOrThrow({ where: { id: older.challengeId } })).consumedAt);
  assert.equal((await verify(older)).status, 400, "an old email cannot sign in after its replacement was delivered");
  assert.equal((await verify(newer)).status, 200);
  assert.equal(await db.user.count({ where: { email: older.email } }), 1);
});

test("a failed resend preserves the previously delivered pending code", async () => {
  const older = await challenge("resend-failure@example.com");
  await db.emailChallenge.update({ where: { id: older.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
  failDelivery = true;
  try {
    assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: older.email }))).status, 503);
  } finally {
    failDelivery = false;
  }
  assert.equal((await db.emailChallenge.findUniqueOrThrow({ where: { id: older.challengeId } })).consumedAt, null);
  const failed = await db.emailChallenge.findFirstOrThrow({ where: { email: older.email, id: { not: older.challengeId } } });
  assert.equal(failed.delivered, false);
  assert.ok(failed.consumedAt);
  assert.equal((await verify(older)).status, 200, "SMTP failure must not lock out someone who already received a valid code");
});

test("sign-out is same-origin, revokes sessions, and rejects forged or expired cookies", async () => {
  const identity = await login("sign-out@example.com");
  const fake = { ...identity, cookie: `artiq_email_session=${"ff".repeat(32)}` };
  assert.equal((await sessionRoute.GET(request("/api/auth/email/session", "GET", undefined, fake))).status, 401);
  assert.equal((await sessionRoute.DELETE(request("/api/auth/email/session", "DELETE", undefined, identity, "https://evil.example"))).status, 403);
  assert.equal((await sessionRoute.GET(request("/api/auth/email/session", "GET", undefined, identity))).status, 200);
  const deletion = await sessionRoute.DELETE(request("/api/auth/email/session", "DELETE", undefined, identity));
  assert.equal(deletion.status, 200);
  assert.match(deletion.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await sessionRoute.GET(request("/api/auth/email/session", "GET", undefined, identity))).status, 401);

  const expired = await login("expired-session@example.com");
  await db.emailSession.updateMany({ where: { userId: expired.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await sessionRoute.GET(request("/api/auth/email/session", "GET", undefined, expired))).status, 401);
});

test("email creators own private uploads and applications without acquiring reviewer or wallet privileges", async () => {
  const owner = await login("art-owner@example.com");
  const other = await login("other-owner@example.com");
  const walletUser = await db.user.create({ data: { walletAddress: reviewerWallet, email: "wallet-contact@example.com" } });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.set("file", new File([png], "art.png", { type: "image/png" }));
  const uploadRequest = new NextRequest(`${origin}/api/uploads`, { method: "POST", headers: { Origin: origin, Cookie: owner.cookie, "X-Artiq-Account-ID": owner.user.id }, body: form });
  const uploaded = await uploads.POST(uploadRequest);
  assert.equal(uploaded.status, 201);
  const { url: imageUrl } = await uploaded.json();
  const id = imageUrl.split("/").pop();
  const storedImage = await db.uploadedImage.findUniqueOrThrow({ where: { id } });
  assert.equal(storedImage.ownerUserId, owner.user.id);
  assert.equal(storedImage.ownerWallet, null);
  assert.equal((await imageRoute.GET(request(imageUrl), { params: { id } })).status, 404);
  assert.equal((await imageRoute.GET(request(imageUrl, "GET", undefined, other), { params: { id } })).status, 404);
  const ownerImageRequest = request(imageUrl, "GET", undefined, owner);
  ownerImageRequest.headers.delete("x-artiq-account-id");
  const image = await imageRoute.GET(ownerImageRequest, { params: { id } });
  assert.equal(image.status, 200, "image elements authenticate using their HttpOnly cookie without custom headers");
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

  const application = {
    itemType: "NFT", creationMethod: "AI_GENERATED", creatorName: "Email creator", contactEmail: walletUser.email,
    title: "Email creator's study", description: "An NFT submitted through a verified email account.",
    imageUrl, priceUsdc: "12.5", maxSupply: 10,
    creatorId: walletUser.id, creatorWalletAddress: reviewerWallet, walletAddress: reviewerWallet, isAdmin: true,
  };
  const legacyWallet = "0x1111111111111111111111111111111111111111";
  const legacyImage = await db.uploadedImage.create({ data: { ownerWallet: legacyWallet, ownerUserId: null, mimeType: "image/png", data: new Uint8Array(png) } });
  const legacyUrl = `/api/uploads/${legacyImage.id}`;
  assert.equal((await imageRoute.GET(request(legacyUrl, "GET", undefined, owner), { params: { id: legacyImage.id } })).status, 404, "email sessions cannot inherit legacy wallet-only uploads");
  assert.equal((await submissions.POST(request("/api/submissions", "POST", { ...application, imageUrl: legacyUrl, creatorWalletAddress: legacyWallet, walletAddress: legacyWallet }, owner))).status, 400, "claiming a wallet in the body cannot assign its old uploads to an email account");
  const legacyOwnerToken = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress: legacyWallet, tokenHash: createHash("sha256").update(legacyOwnerToken).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  const legacyOwnerRequest = new NextRequest(`${origin}${legacyUrl}`, { headers: { Cookie: `artiq_wallet_session=${legacyOwnerToken}` } });
  assert.equal((await imageRoute.GET(legacyOwnerRequest, { params: { id: legacyImage.id } })).status, 200, "the signed owner wallet retains access to its legacy upload");
  const missingAccount = request("/api/submissions", "POST", application, owner);
  missingAccount.headers.delete("x-artiq-account-id");
  assert.equal((await submissions.POST(missingAccount)).status, 401);
  const changedAccount = request("/api/submissions", "POST", application, owner);
  changedAccount.headers.set("x-artiq-account-id", other.user.id);
  assert.equal((await submissions.POST(changedAccount)).status, 401, "cross-tab account changes cannot misattribute artwork");
  assert.equal((await submissions.POST(request("/api/submissions", "POST", application, owner, "https://evil.example"))).status, 403);
  assert.equal((await submissions.POST(request("/api/submissions", "POST", application, other))).status, 400, "other email accounts cannot claim an uploaded image");
  const created = await submissions.POST(request("/api/submissions", "POST", application, owner));
  assert.equal(created.status, 201);
  const { submission } = await created.json();
  assert.equal(submission.creatorId, owner.user.id);
  assert.equal(submission.status, "PENDING");
  assert.equal(submission.creationMethod, "AI_GENERATED");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.user.id } })).walletAddress, null);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: walletUser.id } })).email, walletUser.email, "contact details cannot merge accounts");
  assert.equal(await db.item.count(), 0, "email submissions remain private pending review");
  assert.deepEqual((await (await submissions.GET(request("/api/submissions", "GET", undefined, other))).json()).submissions, []);
  assert.equal((await (await submissions.GET(request("/api/submissions", "GET", undefined, owner))).json()).submissions[0].id, submission.id);
  const impersonation = request("/api/admin/submissions", "GET", undefined, owner);
  impersonation.headers.set("x-wallet-address", reviewerWallet);
  assert.equal((await adminQueue.GET(impersonation)).status, 401);
  assert.equal((await reviewRoute.PATCH(request("/api/admin/submissions/x", "PATCH", { decision: "APPROVED", reviewedBy: reviewerWallet }, owner), { params: { id: submission.id } })).status, 401);
  assert.equal((await walletSessionRoute.GET(request("/api/auth/session", "GET", undefined, owner))).status, 401, "email login never grants a wallet session");

  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress: reviewerWallet, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  const reviewer = new NextRequest(`${origin}/api/admin/submissions/x`, {
    method: "PATCH",
    headers: { Origin: origin, "Content-Type": "application/json", Cookie: `artiq_wallet_session=${token}`, "X-Wallet-Address": reviewerWallet },
    body: JSON.stringify({ decision: "APPROVED" }),
  });
  assert.equal((await reviewRoute.PATCH(reviewer, { params: { id: submission.id } })).status, 200);
  const publicItems = (await (await catalog.GET(request("/api/items?itemType=NFT"))).json()).items;
  assert.equal(publicItems.length, 1);
  assert.equal(publicItems[0].creatorId, owner.user.id);
  assert.equal(publicItems[0].creator.walletAddress, null);
  assert.equal(publicItems[0].creator.email, undefined, "verified creator email is never published");
  assert.equal(publicItems[0].contactEmail, undefined);
  assert.equal((await imageRoute.GET(request(imageUrl), { params: { id } })).status, 200, "approved artwork images become public");
});

test("fails closed when mail is unavailable or delivery fails, and never accepts an undelivered code", async () => {
  const originalPassword = process.env.GMAIL_SMTP_APP_PASSWORD;
  try {
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    assert.equal((await (await requestRoute.GET()).json()).available, false);
    const beforeCount = await db.emailChallenge.count();
    assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "unconfigured@example.com" }))).status, 503);
    assert.equal(await db.emailChallenge.count(), beforeCount);
  } finally {
    process.env.GMAIL_SMTP_APP_PASSWORD = originalPassword;
  }
  failDelivery = true;
  try {
    const response = await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "failed-delivery@example.com" }));
    assert.equal(response.status, 503);
    const stored = await db.emailChallenge.findFirstOrThrow({ where: { email: "failed-delivery@example.com" } });
    assert.equal(stored.delivered, false);
    const delivery = deliveries.findLast((entry) => entry.email === stored.email)!;
    const attempt = { challengeId: stored.id, email: stored.email, code: delivery.code };
    assert.equal((await verifyRoute.POST(request("/api/auth/email/verify", "POST", attempt))).status, 400);
    assert.equal(await db.user.findUnique({ where: { email: stored.email } }), null);
  } finally {
    failDelivery = false;
  }
});

test("enforces persisted resend, per-email, hourly, and daily sending limits", async () => {
  const signed = await challenge("cooldown@example.com");
  const sent = deliveries.length;
  const resend = await requestRoute.POST(request("/api/auth/email/request", "POST", { email: signed.email }));
  assert.equal(resend.status, 429);
  assert.equal(deliveries.length, sent);
  await db.emailChallenge.deleteMany();
  const fixture = (email: string, createdAt: Date) => ({ email, origin, codeHash: "ab".repeat(32), createdAt, expiresAt: new Date(createdAt.getTime() + 10 * 60_000), delivered: true });
  await db.emailChallenge.createMany({ data: Array.from({ length: 5 }, (_, index) => fixture("hour-limit@example.com", new Date(Date.now() - (index + 2) * 60_000))) });
  assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "hour-limit@example.com" }))).status, 429);

  await db.emailChallenge.deleteMany();
  await db.emailChallenge.createMany({ data: Array.from({ length: 100 }, (_, index) => fixture(`hourly-${index}@example.com`, new Date(Date.now() - 5 * 60_000))) });
  assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "global-hour@example.com" }))).status, 429);
  await db.emailChallenge.deleteMany();
  await db.emailChallenge.createMany({ data: Array.from({ length: 300 }, (_, index) => fixture(`daily-${index}@example.com`, new Date(Date.now() - 2 * 60 * 60_000))) });
  assert.equal((await requestRoute.POST(request("/api/auth/email/request", "POST", { email: "global-day@example.com" }))).status, 429);
  assert.equal(deliveries.length, sent, "rate-limited requests never reach SMTP");
});
