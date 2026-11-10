import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { parseUnits, type Address, type Hash } from "viem";

// Disposable database, synthetic sessions and local RPC fixtures only.
const directory = mkdtempSync(join(tmpdir(), "artiq-direct-creation-fee-"));
const origin = "http://localhost:3000";
const owner = `0x${"1".repeat(40)}` as Address;
const other = `0x${"2".repeat(40)}` as Address;
const treasury = `0x${"3".repeat(40)}` as Address;
const linkedWallet = `0x${"8".repeat(40)}` as Address;
const fee = parseUnits("5", 18);
process.env.DATABASE_URL = `file:${join(directory, "payments.db")}`;
process.env.ARTIQ_APP_ORIGIN = origin;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.FEE_RECIPIENT_ADDRESS = treasury;
process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = other;
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;

let db: typeof import("../../lib/prisma")["prisma"];
let payment: typeof import("../../lib/collectionCreationPayment");
let route: typeof import("../../app/api/items/[id]/creation-fee/route");
let paymentData: typeof import("../../lib/collectionCreationFee")["collectionCreationFeeData"];
let ownerId: string;
let otherId: string;
let ownerCookie: string;
let otherCookie: string;
let emailCookie: string;
let emailId: string;
let rpcChain = 5042002;
let reads = 0;
let restore: () => void;
let afterTransactionRead: (() => Promise<void>) | null = null;
let testTime = Date.now();
const transactions = new Map<Hash, Record<string, unknown>>();
const receipts = new Map<Hash, Record<string, unknown>>();
const txHash = (): Hash => `0x${randomBytes(32).toString("hex")}`;

async function walletCookie(walletAddress: string) {
  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  return `artiq_wallet_session=${token}`;
}
async function item(creatorId = ownerId, extra: Record<string, unknown> = {}) {
  return db.item.create({ data: { creatorId, itemType: "NFT", title: "Immediate collection", status: "UPCOMING", ...extra } });
}
function request(itemId: string, body?: unknown, authentication = "owner", browserOrigin = origin, method = body === undefined ? "GET" : "POST") {
  const auth: Record<string, string> = authentication === "owner" ? { Cookie: ownerCookie, "X-Wallet-Address": owner }
    : authentication === "other" ? { Cookie: otherCookie, "X-Wallet-Address": other }
    : authentication === "email" ? { Cookie: emailCookie, "X-Artiq-Account-ID": emailId } : {};
  return new NextRequest(`${origin}/api/items/${itemId}/creation-fee`, { method, headers: { Origin: browserOrigin, ...auth, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function fixture(itemId: string, changes: Record<string, unknown> = {}, receiptChanges: Record<string, unknown> = {}): Hash {
  const hash = txHash();
  transactions.set(hash, { hash, from: owner, to: treasury, chainId: 5042002, value: fee, input: paymentData(itemId), ...changes });
  receipts.set(hash, { transactionHash: hash, status: "success", from: owner, to: treasury, ...receiptChanges });
  return hash;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

before(async () => {
  writeFileSync(join(directory, "payments.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  ownerId = (await db.user.create({ data: { walletAddress: owner } })).id;
  otherId = (await db.user.create({ data: { walletAddress: other } })).id;
  ownerCookie = await walletCookie(owner); otherCookie = await walletCookie(other);
  emailId = (await db.user.create({ data: { email: "email-only@example.com", emailVerifiedAt: new Date() } })).id;
  const token = randomBytes(32).toString("hex");
  await db.emailSession.create({ data: { userId: emailId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) } });
  emailCookie = `artiq_email_session=${token}`;
  payment = await import("../../lib/collectionCreationPayment");
  ({ collectionCreationFeeData: paymentData } = await import("../../lib/collectionCreationFee"));
  route = await import("../../app/api/items/[id]/creation-fee/route");
  const client = payment.collectionCreationPaymentClient;
  const original = { getChainId: client.getChainId, getTransaction: client.getTransaction, getTransactionReceipt: client.getTransactionReceipt };
  Object.assign(client, {
    getChainId: async () => { reads++; return rpcChain; },
    getTransaction: async ({ hash }: { hash: Hash }) => { reads++; const result = transactions.get(hash); if (!result) throw new Error("Receipt unavailable"); if (afterTransactionRead) await afterTransactionRead(); return result; },
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => { reads++; const result = receipts.get(hash); if (!result) throw new Error("Receipt unavailable"); return result; },
  });
  restore = () => Object.assign(client, original);
});
beforeEach(async (t) => {
  testTime += 60_000;
  assert.ok("mock" in t, "This hook runs for individual tests.");
  t.mock.timers.enable({ apis: ["Date"], now: testTime });
  await db.collectionCreationPayment.deleteMany();
  await db.item.deleteMany();
  await db.privySession.deleteMany();
  await db.user.update({ where: { id: ownerId }, data: { privyId: null } });
  transactions.clear(); receipts.clear(); reads = 0; rpcChain = 5042002; afterTransactionRead = null;
  process.env.FEE_RECIPIENT_ADDRESS = treasury;
});
after(async () => { restore?.(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("owner sees the fixed fee and server-selected treasury without exposing payment status to others", async () => {
  const collection = await item();
  const response = await route.GET(request(collection.id), context(collection.id));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { paid: false, requiresPayment: true, alreadyCreated: false, amount: fee.toString(), recipient: treasury, chainId: 5042002, paymentData: paymentData(collection.id), payment: null });
  assert.equal((await route.GET(request(collection.id, undefined, "anonymous"), context(collection.id))).status, 401);
  assert.equal((await route.GET(request(collection.id, undefined, "other"), context(collection.id))).status, 404);
  assert.equal(reads, 0);
});

test("anonymous, foreign-origin, unbound, walletless and non-owner confirmations fail before RPC", async () => {
  const collection = await item(); const body = { txHash: fixture(collection.id) };
  assert.equal((await route.POST(request(collection.id, body, "anonymous"), context(collection.id))).status, 401);
  assert.equal((await route.POST(request(collection.id, body, "owner", "https://attacker.example"), context(collection.id))).status, 403);
  assert.equal((await route.POST(request(collection.id, body, "other"), context(collection.id))).status, 403);
  assert.equal((await route.POST(request(collection.id, body, "email"), context(collection.id))).status, 403);
  const unbound = request(collection.id, body); unbound.headers.set("X-Wallet-Address", other);
  assert.equal((await route.POST(unbound, context(collection.id))).status, 401);
  assert.equal((await route.POST(request(collection.id, { txHash: "not-a-hash" }), context(collection.id))).status, 400);
  const art = await item(ownerId, { itemType: "WEB2_ART" });
  assert.equal((await route.POST(request(art.id, body), context(art.id))).status, 403);
  assert.equal(reads, 0); assert.equal(await db.collectionCreationPayment.count(), 0);
});

test("confirmed direct payment is stored once and retries do not read RPC or charge another wallet", async () => {
  const collection = await item(); const hash = fixture(collection.id);
  const responses = await Promise.all(Array.from({ length: 2 }, () => route.POST(request(collection.id, { txHash: hash }), context(collection.id))));
  assert.ok(responses.every((response) => response.status === 200), JSON.stringify(responses.map((response) => response.status)));
  assert.equal(await db.collectionCreationPayment.count(), 1);
  const row = await payment.getCollectionCreationPayment(collection.id);
  assert.equal(row?.ownerUserId, ownerId); assert.equal(row?.txHash, hash);
  assert.equal(row?.amount, fee.toString()); assert.equal(row?.recipientWallet, treasury);
  const before = reads;
  const retried = await route.POST(request(collection.id, { txHash: hash.toUpperCase().replace("0X", "0x") }), context(collection.id));
  assert.equal(retried.status, 200); assert.equal(reads, before);
  const status = await (await route.GET(request(collection.id), context(collection.id))).json();
  assert.equal(status.paid, true); assert.equal(status.requiresPayment, false); assert.equal(status.payment.txHash, hash);
  assert.equal((await route.POST(request(collection.id, { txHash: fixture(collection.id) }), context(collection.id))).status, 409);
  assert.equal(reads, before, "an already credited item never invites a replacement payment");
});

test("one payment cannot be replayed for another collection and the data tag binds otherwise identical transfers", async () => {
  const first = await item(); const second = await item(); const hash = fixture(first.id);
  assert.equal((await route.POST(request(first.id, { txHash: hash }), context(first.id))).status, 200);
  const readCount = reads;
  const replay = await route.POST(request(second.id, { txHash: hash }), context(second.id));
  assert.equal(replay.status, 409); assert.equal((await replay.json()).code, "CREATION_PAYMENT_REUSED");
  assert.equal(reads, readCount);
  const unrelated = fixture(first.id);
  assert.equal((await route.POST(request(second.id, { txHash: unrelated }), context(second.id))).status, 400);
  assert.equal(await db.collectionCreationPayment.count(), 1);
});

test("wrong value, recipient, wallet, chain, receipt or payment tag never credits a collection", async () => {
  const collection = await item();
  const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [{ value: fee - BigInt(1) }, {}], [{ value: fee + BigInt(1) }, {}],
    [{ to: other }, { to: other }], [{ from: other }, { from: other }],
    [{ chainId: 1 }, {}], [{ input: "0x" }, {}], [{ input: paymentData("another-collection") }, {}],
    [{}, { status: "reverted" }], [{}, { from: other }], [{}, { to: other }],
    [{ hash: txHash() }, {}], [{}, { transactionHash: txHash() }],
  ];
  for (const [changes, receiptChanges] of cases) {
    const hash = fixture(collection.id, changes, receiptChanges);
    const response = await route.POST(request(collection.id, { txHash: hash, recipient: other, amount: "1", paid: true }), context(collection.id));
    assert.equal(response.status, 400, JSON.stringify({ changes, receiptChanges }, (_key, value) => typeof value === "bigint" ? value.toString() : value));
    assert.equal(await db.collectionCreationPayment.count(), 0);
  }
  rpcChain = 1;
  assert.equal((await route.POST(request(collection.id, { txHash: fixture(collection.id) }), context(collection.id))).status, 400);
});

test("RPC outages leave the payment uncredited and the same hash can recover after confirmation", async () => {
  const collection = await item(); const hash = txHash();
  const outage = await route.POST(request(collection.id, { txHash: hash }), context(collection.id));
  assert.equal(outage.status, 503); assert.equal((await outage.json()).code, "CREATION_PAYMENT_UNAVAILABLE");
  assert.equal(await db.collectionCreationPayment.count(), 0);
  const validHash = fixture(collection.id);
  transactions.set(hash, { ...transactions.get(validHash), hash });
  receipts.set(hash, { ...receipts.get(validHash), transactionHash: hash });
  assert.equal((await route.POST(request(collection.id, { txHash: hash }), context(collection.id))).status, 200);
});

test("treasury changes and linked-wallet switches preserve the paid collection credit", async () => {
  const collection = await item(); const hash = fixture(collection.id);
  assert.equal((await route.POST(request(collection.id, { txHash: hash }), context(collection.id))).status, 200);
  process.env.FEE_RECIPIENT_ADDRESS = other;
  const status = await (await route.GET(request(collection.id), context(collection.id))).json();
  assert.equal(status.paid, true); assert.equal(status.recipient, treasury);
  await db.user.update({ where: { id: ownerId }, data: { privyId: "did:privy:payment-owner" } });
  const token = randomBytes(32).toString("hex");
  await db.privySession.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: ownerId, privyDid: "did:privy:payment-owner", verifiedEmail: null, walletAddresses: [owner, linkedWallet], expiresAt: new Date(Date.now() + 60_000) } });
  const switched = request(collection.id, { txHash: hash }, "anonymous");
  switched.cookies.set("artiq_privy_session", token);
  switched.headers.set("X-Artiq-Account-ID", ownerId); switched.headers.set("X-Wallet-Address", linkedWallet);
  const readCount = reads;
  assert.equal((await route.POST(switched, context(collection.id))).status, 200);
  assert.equal(reads, readCount);
});

test("already created collections do not request or accept a new payment", async () => {
  const collection = await item(ownerId, { contractAddress: other });
  const status = await (await route.GET(request(collection.id), context(collection.id))).json();
  assert.equal(status.paid, true); assert.equal(status.requiresPayment, false); assert.equal(status.alreadyCreated, true); assert.equal(status.recipient, null);
  assert.equal((await route.POST(request(collection.id, { txHash: fixture(collection.id) }), context(collection.id))).status, 409);
  assert.equal(reads, 0);
});

test("ownership and deployment races after RPC cannot create a misplaced payment credit", async () => {
  for (const change of [{ creatorId: otherId }, { contractAddress: other }, { itemType: "WEB2_ART" as const }]) {
    const collection = await item(); const hash = fixture(collection.id);
    afterTransactionRead = async () => { await db.item.update({ where: { id: collection.id }, data: change }); };
    const response = await route.POST(request(collection.id, { txHash: hash }), context(collection.id));
    assert.equal(response.status, 409);
    assert.equal(await db.collectionCreationPayment.count(), 0);
  }
});

test("concurrent different payment hashes leave only one collection credit", async () => {
  const collection = await item(); const first = fixture(collection.id); const second = fixture(collection.id);
  const responses = await Promise.all([first, second].map((hash) => route.POST(request(collection.id, { txHash: hash }), context(collection.id))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await db.collectionCreationPayment.count(), 1);
  const stored = await payment.getCollectionCreationPayment(collection.id);
  assert.ok(stored?.txHash === first || stored?.txHash === second);
});

test("legacy transaction responses may omit chainId only when the trusted RPC verifies Arc Testnet", async () => {
  const collection = await item(); const hash = fixture(collection.id, { chainId: undefined });
  assert.equal((await route.POST(request(collection.id, { txHash: hash }), context(collection.id))).status, 200);
});

test("a payment record prevents deletion from releasing its transaction for reuse", async () => {
  const collection = await item(); const hash = fixture(collection.id);
  assert.equal((await route.POST(request(collection.id, { txHash: hash }), context(collection.id))).status, 200);
  await assert.rejects(db.item.delete({ where: { id: collection.id } }));
  assert.equal(await db.collectionCreationPayment.count(), 1);
});
