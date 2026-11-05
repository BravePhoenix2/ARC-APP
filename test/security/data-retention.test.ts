import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDataRetention, applyDataRetention } from "../../lib/dataRetention";

const directory = mkdtempSync(join(tmpdir(), "artiq-retention-"));
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
let db: (typeof import("../../lib/prisma"))["prisma"];
const now = new Date("2026-11-05T12:00:00Z");
const old = new Date("2026-10-01T12:00:00Z");
let userId: string; let orphanId: string; let recentId: string;
const referencedIds: string[] = [];

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  const user = await db.user.create({ data: { username: "Retention fixture" } }); userId = user.id;
  async function image(createdAt = old) { return db.uploadedImage.create({ data: { ownerUserId: userId, mimeType: "image/png", data: new Uint8Array([1]), byteSize: 1, createdAt } }); }
  orphanId = (await image()).id; recentId = (await image(new Date(now.getTime() - 60_000))).id;
  const published = await image(); const application = await image(); const series = await image(); const auction = await image();
  referencedIds.push(published.id, application.id, series.id, auction.id);
  await db.item.create({ data: { itemType: "NFT", title: "Published", creatorId: userId, imageUrl: `/api/uploads/${published.id}` } });
  const pending = await db.submission.create({ data: { creatorId: userId, creatorName: "Artist", itemType: "NFT", title: "Rejected but retained", description: "Fixture", priceUsdc: 0, imageUrl: `/api/uploads/${application.id}`, status: "REJECTED" } });
  await db.collectionImage.create({ data: { submissionId: pending.id, imageUrl: `/api/uploads/${series.id}`, filename: "series.png", position: 1 } });
  await db.assetAuction.create({ data: { sellerId: userId, sellerWallet: "0x1111111111111111111111111111111111111111", kind: "DIGITAL", title: "Draft", description: "Draft auction", imageUrl: `/api/uploads/${auction.id}`, deliveryTerms: "Test delivery", reservePrice: "1", endsAt: now, assetKey: "retained-draft", marketAddress: "0x2222222222222222222222222222222222222222" } });
  await db.walletSession.createMany({ data: [
    { walletAddress: "wallet", tokenHash: "expired-old", expiresAt: old },
    { walletAddress: "wallet", tokenHash: "recently-expired", expiresAt: new Date(now.getTime() - 60_000) },
    { walletAddress: "wallet", tokenHash: "active", expiresAt: new Date(now.getTime() + 60_000) },
  ] });
});
after(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("preview retains referenced and recent images and makes no changes", async () => {
  const beforeCount = await db.uploadedImage.count(); const plan = await planDataRetention(db, now);
  assert.deepEqual(plan.orphans.map((image) => image.id), [orphanId]);
  assert.equal(plan.sessions.reduce((count, rows) => count + rows.length, 0), 1);
  assert.equal(await db.uploadedImage.count(), beforeCount);
  assert.equal(await db.walletSession.count(), 3);
  await assert.rejects(applyDataRetention(db, plan, false), /Stop all content writers/);
  assert.equal(await db.walletSession.count(), 3, "an unacknowledged apply refuses before making any writes");
});

test("session-only cleanup deletes old expired credentials without pausing uploads", async () => {
  const plan = await planDataRetention(db, now, true); assert.equal(plan.orphans.length, 0);
  const result = await applyDataRetention(db, plan, false); assert.equal(result.removedExpiredCredentials, 1);
  assert.equal(await db.walletSession.count(), 2); assert.ok(await db.uploadedImage.findUnique({ where: { id: orphanId } }));
});

test("orphan apply rechecks references and preserves newly attached images", async () => {
  const plan = await planDataRetention(db, now);
  await db.item.create({ data: { itemType: "NFT", title: "Attached after preview", creatorId: userId, imageUrl: `/api/uploads/${orphanId}` } });
  const result = await applyDataRetention(db, plan, true); assert.equal(result.removedUploads, 0);
  for (const id of [orphanId, recentId, ...referencedIds]) assert.ok(await db.uploadedImage.findUnique({ where: { id } }));
});

test("a confirmed maintenance batch deletes only old unreferenced uploads", async () => {
  const orphan = await db.uploadedImage.create({ data: { ownerUserId: userId, mimeType: "image/png", data: new Uint8Array([1]), byteSize: 1, createdAt: old } });
  const plan = await planDataRetention(db, now); const result = await applyDataRetention(db, plan, true);
  assert.equal(result.removedUploads, 1); assert.equal(await db.uploadedImage.findUnique({ where: { id: orphan.id } }), null);
  for (const id of [orphanId, recentId, ...referencedIds]) assert.ok(await db.uploadedImage.findUnique({ where: { id } }));
});
