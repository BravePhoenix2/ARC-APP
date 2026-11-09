import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { parseSubmission } from "../../lib/submissionValidation";

const directory = mkdtempSync(join(tmpdir(), "artiq-nft-import-regression-"));
const origin = "http://localhost:3000";
const wallet = "0x1111111111111111111111111111111111111111";
const importedContract = "0x3333333333333333333333333333333333333333";
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_APP_ORIGIN = origin;
process.env.ARTIQ_ADMIN_EMAILS = "reviewer@pentest.invalid";
process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
for (const key of ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_ID", "ARTIQ_SECURITY_REDIS_URL", "ARTIQ_SECURITY_REDIS_TOKEN", "ARTIQ_TRUSTED_PROXY"]) delete process.env[key];

const application = {
  itemType: "NFT", creatorName: "Creator", title: "Reviewed collection",
  description: "A reviewed collection awaiting verified deployment.",
  imageUrl: "https://example.invalid/cover.png", priceUsdc: "0", maxSupply: 1,
  nftKind: "SOULBOUND", royaltyBps: 0,
};
let db: typeof import("../../lib/prisma")["prisma"];
let submissions: typeof import("../../app/api/submissions/route");
let review: typeof import("../../app/api/admin/submissions/[id]/route");
let creatorId: string;
let reviewerId: string;
let ownerCookie: string;
let reviewerCookie: string;

function request(path: string, method: string, body: unknown, reviewer = false) {
  return new NextRequest(`${origin}${path}`, {
    method, headers: {
      Origin: origin, "Content-Type": "application/json",
      Cookie: reviewer ? reviewerCookie : ownerCookie,
      ...(reviewer ? { "X-Artiq-Account-ID": reviewerId } : { "X-Wallet-Address": wallet }),
    }, body: JSON.stringify(body),
  });
}

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  creatorId = (await db.user.create({ data: { walletAddress: wallet } })).id;
  reviewerId = (await db.user.create({ data: { email: "reviewer@pentest.invalid", emailVerifiedAt: new Date() } })).id;
  const ownerToken = randomBytes(32).toString("hex");
  const reviewerToken = randomBytes(32).toString("hex");
  const digest = (token: string) => createHash("sha256").update(token).digest("hex");
  await db.walletSession.create({ data: { walletAddress: wallet, tokenHash: digest(ownerToken), expiresAt: new Date(Date.now() + 600_000) } });
  await db.emailSession.create({ data: { userId: reviewerId, tokenHash: digest(reviewerToken), expiresAt: new Date(Date.now() + 600_000) } });
  ownerCookie = `artiq_wallet_session=${ownerToken}`;
  reviewerCookie = `artiq_email_session=${reviewerToken}`;
  [submissions, review] = await Promise.all([import("../../app/api/submissions/route"), import("../../app/api/admin/submissions/[id]/route")]);
});
after(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("NFT submission cannot import a contract through a supplied address", async () => {
  const beforeCount = await db.submission.count();
  for (const contractAddress of [importedContract, "not-an-address", { address: importedContract }]) {
    const response = await submissions.POST(request("/api/submissions", "POST", { ...application, contractAddress }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /without an existing contract address/);
  }
  assert.equal(await db.submission.count(), beforeCount);
  assert.equal(await db.item.count(), 0);
});

test("legacy pending imports cannot publish through reviewer approval and remain rejectable", async () => {
  const { images: _images, ...details } = parseSubmission(application);
  const pending = await db.submission.create({ data: { ...details, creatorId, contractAddress: importedContract } });
  const context = { params: Promise.resolve({ id: pending.id }) };
  const response = await review.PATCH(request(`/api/admin/submissions/${pending.id}`, "PATCH", { decision: "APPROVED" }, true), context);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /unverified existing contract/);
  const unchanged = await db.submission.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(unchanged.status, "PENDING");
  assert.equal(unchanged.itemId, null);
  assert.equal(await db.item.count(), 0);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: creatorId } })).isCreator, false);
  const rejected = await review.PATCH(request(`/api/admin/submissions/${pending.id}`, "PATCH", { decision: "REJECTED", reviewNote: "Resubmit without the existing contract so deployment can be verified." }, true), context);
  assert.equal(rejected.status, 200);
  assert.equal((await db.submission.findUniqueOrThrow({ where: { id: pending.id } })).status, "REJECTED");
});

test("normal NFTs publish without review and still require the verified deployment flow", async () => {
  const created = await submissions.POST(request("/api/submissions", "POST", application));
  assert.equal(created.status, 201);
  const submission = (await created.json()).submission;
  assert.equal(submission.status, "APPROVED");
  assert.ok(submission.itemId);
  const approved = await review.PATCH(request(`/api/admin/submissions/${submission.id}`, "PATCH", { decision: "APPROVED" }, true), { params: Promise.resolve({ id: submission.id }) });
  assert.equal(approved.status, 409, "reviewing an already published NFT cannot create a duplicate");
  const item = await db.item.findUniqueOrThrow({ where: { id: submission.itemId } });
  assert.equal(item.creatorId, creatorId);
  assert.equal(item.contractAddress, null);
  assert.equal(item.deploymentFactory, null);
  assert.equal(item.nftKind, "SOULBOUND");
});

test("previously published imports are quarantined from detail and metadata even if a factory was pinned", async () => {
  const legacy = await db.item.create({ data: {
    creatorId, itemType: "NFT", title: "Unverified historical import", contractAddress: importedContract,
    deploymentFactory: wallet, imageCount: 2, imageUrl: application.imageUrl,
    collectionImages: { create: { position: 1, filename: "one.png", imageUrl: application.imageUrl } },
  } });
  const { images: _images, ...details } = parseSubmission(application);
  await db.submission.create({ data: { ...details, creatorId, contractAddress: importedContract, itemId: legacy.id, status: "APPROVED" } });
  const [detail, metadata, tokenMetadata] = await Promise.all([
    import("../../app/api/items/[id]/route"), import("../../app/api/items/[id]/metadata/route"), import("../../app/api/items/[id]/metadata/[tokenId]/route"),
  ]);
  const anonymous = new NextRequest(`${origin}/api/items/${legacy.id}`);
  assert.equal((await detail.GET(anonymous, { params: Promise.resolve({ id: legacy.id }) })).status, 404);
  assert.equal((await metadata.GET(anonymous, { params: Promise.resolve({ id: legacy.id }) })).status, 404);
  assert.equal((await tokenMetadata.GET(anonymous, { params: Promise.resolve({ id: legacy.id, tokenId: "1" }) })).status, 404);
  assert.ok(await db.item.findUnique({ where: { id: legacy.id } }), "quarantine does not delete existing records");
  const privateSubmissions = await submissions.GET(new NextRequest(`${origin}/api/submissions`, { headers: { Cookie: ownerCookie, "X-Wallet-Address": wallet } }));
  assert.equal(privateSubmissions.status, 200);
  assert.ok((await privateSubmissions.json()).submissions.some((submission: { itemId: string | null }) => submission.itemId === legacy.id));
});
