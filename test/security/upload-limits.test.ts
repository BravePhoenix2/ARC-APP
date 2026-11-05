import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { maxAccountImageBytes } from "../../lib/imageUpload";

const directory = mkdtempSync(join(tmpdir(), "artiq-upload-limits-"));
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_AI_PIXEL_SCREENING = "false";
process.env.ARTIQ_UPLOAD_STORAGE = "database";
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID; delete process.env.PRIVY_APP_ID;
delete process.env.ARTIQ_APP_ORIGIN; process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
const ownerWallet = "0x1111111111111111111111111111111111111111";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
let db: (typeof import("../../lib/prisma"))["prisma"];
let uploads: typeof import("../../app/api/uploads/route");
let submissions: typeof import("../../app/api/submissions/route");
let userId: string; let cookie: string;
function upload(data = png, itemType?: string) {
  const form = new FormData(); form.set("file", new File([new Uint8Array(data)], "art.png", { type: "image/png" }));
  if (itemType) form.set("itemType", itemType);
  return uploads.POST(new NextRequest("http://localhost:3000/api/uploads", { method: "POST", headers: { Origin: "http://localhost:3000", Cookie: cookie, "X-Wallet-Address": ownerWallet }, body: form }));
}
before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  uploads = await import("../../app/api/uploads/route"); submissions = await import("../../app/api/submissions/route");
  const user = await db.user.create({ data: { walletAddress: ownerWallet } }); userId = user.id;
  const token = randomBytes(32).toString("hex"); cookie = `artiq_wallet_session=${token}`;
  await db.walletSession.create({ data: { walletAddress: ownerWallet, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000) } });
});
afterEach(async () => { await db.submission.deleteMany(); await db.uploadedImage.deleteMany(); });
after(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("old retained images count toward the total account budget independently of hourly quotas", async () => {
  await db.uploadedImage.create({ data: { ownerUserId: userId, ownerWallet, mimeType: "image/png", data: new Uint8Array(png), byteSize: maxAccountImageBytes, createdAt: new Date(Date.now() - 24 * 60 * 60_000) } });
  const response = await upload(); assert.equal(response.status, 429);
  assert.match((await response.json()).error, /500 MB/);
  assert.equal(await db.uploadedImage.count(), 1);
});

test("the hourly still-art cap is preserved while an ordinary NFT image series remains allowed", async () => {
  await db.uploadedImage.createMany({ data: Array.from({ length: 30 }, () => ({ ownerUserId: userId, ownerWallet, mimeType: "image/png", data: new Uint8Array(png), byteSize: png.length })) });
  const art = await upload(); assert.equal(art.status, 429); assert.match((await art.json()).error, /Hourly/);
  assert.equal((await upload(png, "NFT")).status, 201);
});

test("original generation evidence survives upload sanitization and an ART submission", async () => {
  const bytes = await sharp(png).withExif({ IFD0: { ImageDescription: "Private prompt\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 1234", Artist: "Private artist" } }).png().toBuffer();
  const uploaded = await upload(bytes); assert.equal(uploaded.status, 201);
  const result = await uploaded.json(); assert.equal(result.screening.status, "FLAGGED");
  const stored = await db.uploadedImage.findUniqueOrThrow({ where: { id: result.url.split("/").pop() } });
  assert.equal((await sharp(stored.data).metadata()).exif, undefined);
  const response = await submissions.POST(new NextRequest("http://localhost:3000/api/submissions", {
    method: "POST", headers: { Origin: "http://localhost:3000", Cookie: cookie, "X-Wallet-Address": ownerWallet, "Content-Type": "application/json" },
    body: JSON.stringify({ itemType: "WEB2_ART", creatorName: "Artist", title: "Handmade study", description: "A painted study on canvas.", imageUrl: result.url, priceUsdc: "1", category: "PAINTING", creationMethod: "HUMAN", humanMadeDeclaration: true, creationProcess: "I painted this work with acrylic on cotton canvas using my own hand drawn studies." }),
  }));
  assert.equal(response.status, 201); const body = await response.json();
  assert.equal(body.submission.screening.status, "FLAGGED");
  assert.ok(body.submission.screening.signals.some((signal: { code: string }) => signal.code === "DIFFUSION_PARAMETERS"));
  assert.doesNotMatch(JSON.stringify(body.submission.screening), /Private prompt|Private artist/);
});
