import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseUnits, toHex, zeroAddress, type Address, type Hash } from "viem";

const directory = mkdtempSync(join(tmpdir(), "artiq-catalog-sync-"));
const origin = "http://localhost:3000";
const factory = "0x1111111111111111111111111111111111111111" as Address;
const collection = "0x2222222222222222222222222222222222222222" as Address;
const market = "0x3333333333333333333333333333333333333333" as Address;
const owner = "0x4444444444444444444444444444444444444444" as Address;
const other = "0x5555555555555555555555555555555555555555" as Address;
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_APP_ORIGIN = origin;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS = factory;
process.env.NEXT_PUBLIC_ART_MARKET_ADDRESS = market;
let db: typeof import("../../lib/prisma")["prisma"];
let sync: typeof import("../../lib/catalogSync");
let route: typeof import("../../app/api/items/[id]/sync/route");
let statusRoute: typeof import("../../app/api/items/[id]/status/route");
let catalog: typeof import("../../app/api/items/route");
let userId: string;
let cookie: string;
let restore: () => void;
let chainId = 5042002;
let blockNumber = BigInt(100);
let totalMinted = BigInt(2);
let maxSupply = BigInt(2);
let starts = BigInt(0);
let registry = factory;
let supportsManagement = false;
let mintClosed = false;
let reads = 0;
let contractReads: Array<{ address: Address; functionName: string; blockNumber?: bigint }> = [];
let listing: readonly [Address, `0x${string}`, bigint, Address, boolean];
const receipts = new Map<string, Record<string, unknown>>();
const mint721 = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 firstTokenId,uint256 totalPaid)"]);
const mint1155 = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 totalPaid)"]);
const artPurchased = parseAbi(["event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)"]);

const hash = (): Hash => `0x${randomBytes(32).toString("hex")}`;
function request(path: string, body: unknown, authentication = true, browserOrigin = origin, method = "POST") {
  return new NextRequest(`${origin}${path}`, { method, headers: { Origin: browserOrigin, "Content-Type": "application/json", ...(authentication ? { Cookie: cookie, "X-Wallet-Address": owner } : {}) }, body: JSON.stringify(body) });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
async function nft(overrides: Record<string, unknown> = {}) {
  return db.item.create({ data: { creatorId: userId, itemType: "NFT", title: "Verified collection", nftKind: "COLLECTIBLE", contractAddress: collection, deploymentFactory: factory, maxSupply: 2, mintedCount: 0, status: "UPCOMING", ...overrides } });
}
function mintReceipt(edition = false, changes: Record<string, unknown> = {}): Hash {
  const txHash = hash();
  const topics = edition ? encodeEventTopics({ abi: mint1155, eventName: "Minted", args: { to: owner } }) : encodeEventTopics({ abi: mint721, eventName: "Minted", args: { to: owner } });
  const data = encodeAbiParameters(edition ? [{ type: "uint256" }, { type: "uint256" }] : [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], edition ? [BigInt(1), BigInt(0)] : [BigInt(1), BigInt(1), BigInt(0)]);
  receipts.set(txHash, { status: "success", from: owner, to: collection, blockNumber, logs: [{ address: collection, topics, data }], ...changes });
  return txHash;
}

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  userId = (await db.user.create({ data: { walletAddress: owner } })).id;
  const token = randomBytes(32).toString("hex");
  cookie = `artiq_wallet_session=${token}`;
  await db.walletSession.create({ data: { walletAddress: owner, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) } });
  sync = await import("../../lib/catalogSync");
  const original = { getChainId: sync.catalogSyncClient.getChainId, getBlock: sync.catalogSyncClient.getBlock, readContract: sync.catalogSyncClient.readContract, getTransactionReceipt: sync.catalogSyncClient.getTransactionReceipt };
  Object.assign(sync.catalogSyncClient, {
    getChainId: async () => { reads++; return chainId; },
    getBlock: async () => { reads++; return { number: blockNumber, timestamp: BigInt(Math.floor(Date.now() / 1000)) }; },
    getTransactionReceipt: async ({ hash: txHash }: { hash: Hash }) => { reads++; const receipt = receipts.get(txHash); if (!receipt) throw new Error("Missing receipt"); return receipt; },
    readContract: async ({ address, functionName, blockNumber: atBlock }: { address: Address; functionName: string; blockNumber?: bigint }) => {
      reads++;
      contractReads.push({ address, functionName, blockNumber: atBlock });
      const values: Record<string, unknown> = { collectionCreator: owner, registry, totalMinted, maxSupply, mintStartTime: starts, listings: listing, supportsMintManagement: supportsManagement, mintClosed };
      if (!(functionName in values)) throw new Error("Unexpected contract read");
      return values[functionName];
    },
  });
  restore = () => Object.assign(sync.catalogSyncClient, original);
  route = await import("../../app/api/items/[id]/sync/route");
  statusRoute = await import("../../app/api/items/[id]/status/route");
  catalog = await import("../../app/api/items/route");
});
beforeEach(async () => {
  await db.submission.deleteMany();
  await db.item.deleteMany();
  receipts.clear();
  chainId = 5042002; blockNumber = BigInt(100); totalMinted = BigInt(2); maxSupply = BigInt(2); starts = BigInt(0); registry = factory; reads = 0; contractReads = [];
  supportsManagement = false; mintClosed = false;
});
after(async () => { restore?.(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("catalog sync rejects anonymous, cross-origin and malformed requests before RPC", async () => {
  const item = await nft();
  const path = `/api/items/${item.id}/sync`;
  assert.equal((await route.POST(request(path, { txHash: hash() }, false), context(item.id))).status, 401);
  assert.equal((await route.POST(request(path, { txHash: hash() }, true, "https://attacker.example"), context(item.id))).status, 403);
  assert.equal((await route.POST(request(path, { txHash: "invalid" }), context(item.id))).status, 400);
  assert.equal(reads, 0);
});

test("a verified ERC-721 mint updates stored count and sold-out status without trusting client counts", async () => {
  const item = await nft();
  const response = await route.POST(request(`/api/items/${item.id}/sync`, { txHash: mintReceipt(), mintedCount: 999999, status: "LIVE" }), context(item.id));
  assert.equal(response.status, 200);
  const stored = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(stored.mintedCount, 2);
  assert.equal(stored.status, "MINTED_OUT");
  assert.equal((await response.json()).item.creatorId, undefined, "sync response exposes only availability");
});

test("ERC-1155 receipts sync while forged senders, foreign events, wrong chains and registry mismatches fail", async () => {
  const item = await nft({ nftKind: "EDITION" });
  const path = `/api/items/${item.id}/sync`;
  for (const changes of [{ from: other }, { to: other }, { status: "reverted" }, { logs: [] }]) {
    assert.equal((await route.POST(request(path, { txHash: mintReceipt(true, changes) }), context(item.id))).status, 400);
  }
  chainId = 1;
  assert.equal((await route.POST(request(path, { txHash: mintReceipt(true) }), context(item.id))).status, 400);
  chainId = 5042002; registry = other;
  assert.equal((await route.POST(request(path, { txHash: mintReceipt(true) }), context(item.id))).status, 400);
  registry = factory;
  assert.equal((await route.POST(request(path, { txHash: mintReceipt(true) }), context(item.id))).status, 200);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).mintedCount, 2);
});

test("a stale chain snapshot cannot reduce a verified minted count or move an open collection backwards", async () => {
  const soldOut = await nft({ mintedCount: 2, status: "MINTED_OUT" });
  totalMinted = BigInt(1);
  const result = await sync.reconcileCatalogItem(soldOut);
  assert.equal(result.mintedCount, 2);
  assert.equal(result.status, "MINTED_OUT");
  const live = await nft({ mintedCount: 1, status: "LIVE" });
  starts = BigInt(Math.floor(Date.now() / 1000) + 10000);
  assert.equal((await sync.reconcileCatalogItem(live)).status, "LIVE");
  const legacy = await nft({ mintedCount: null, status: null });
  assert.equal((await sync.reconcileCatalogItem(legacy)).status, "UPCOMING", "legacy null state can acquire its verified schedule");
});

test("old collections use their pinned factory and a single block snapshot after a protocol upgrade", async () => {
  const item = await nft({ deploymentFactory: other });
  registry = other;
  await sync.reconcileCatalogItem(item);
  assert.equal(contractReads.find((read) => read.functionName === "collectionCreator")?.address, other);
  assert.ok(contractReads.every((read) => read.blockNumber === blockNumber));
});

test("managed collection reconciliation records reduced supply without losing minted tokens", async () => {
  const item = await nft({ maxSupply: 10, mintedCount: 1, status: "LIVE" });
  supportsManagement = true;
  maxSupply = BigInt(5); totalMinted = BigInt(2);
  await sync.reconcileCatalogItem(item);
  const stored = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(stored.maxSupply, 5);
  assert.equal(stored.mintedCount, 2);
  assert.equal(stored.status, "LIVE");
  maxSupply = BigInt(6); blockNumber++;
  await assert.rejects(sync.reconcileCatalogItem(stored, blockNumber), sync.CatalogSyncError, "a later snapshot must not increase a reduced cap");
});

test("legacy collections cannot change catalog supply through management reconciliation", async () => {
  const item = await nft({ maxSupply: 10, mintedCount: 1 });
  maxSupply = BigInt(5); totalMinted = BigInt(2);
  await assert.rejects(sync.reconcileCatalogItem(item), sync.CatalogSyncError);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).maxSupply, 10);
});

test("creator closure is distinct from sold out and stale snapshots cannot reopen a closed mint", async () => {
  const item = await nft({ maxSupply: 10, mintedCount: 2, status: "LIVE" });
  supportsManagement = true; mintClosed = true; maxSupply = BigInt(10);
  assert.equal((await sync.reconcileCatalogItem(item)).status, "CLOSED");
  const stored = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(stored.mintedCount, 2);
  mintClosed = false; blockNumber++;
  assert.equal((await sync.reconcileCatalogItem(stored, blockNumber)).status, "CLOSED");
  const response = await catalog.GET(new NextRequest(`${origin}/api/items?itemType=NFT&status=CLOSED`));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items.map((entry: { id: string }) => entry.id), [item.id]);
});

test("a confirmed art purchase marks availability sold without requiring a delivery order", async () => {
  const item = await db.item.create({ data: { creatorId: userId, itemType: "WEB2_ART", title: "Testnet art", priceUsdc: 25, sold: false, quantityAvailable: 1, artMarketAddress: market, artListingSeller: owner, artListingId: "7" } });
  listing = [owner, keccak256(toHex(item.id)), parseUnits("25", 18), owner, false];
  const txHash = hash();
  receipts.set(txHash, { status: "success", from: owner, to: market, blockNumber, logs: [{ address: market, topics: encodeEventTopics({ abi: artPurchased, eventName: "ArtPurchased", args: { listingId: BigInt(7), buyer: owner } }), data: encodeAbiParameters([{ type: "uint256" }], [parseUnits("25", 18)]) }] });
  const response = await route.POST(request(`/api/items/${item.id}/sync`, { txHash }), context(item.id));
  assert.equal(response.status, 200);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).sold, true);
  assert.equal(await db.artOrder.count(), 0);
  blockNumber = BigInt(200); listing = [owner, keccak256(toHex(item.id)), parseUnits("25", 18), zeroAddress, false];
  assert.equal((await sync.reconcileCatalogItem(item, blockNumber)).sold, true, "a pre-sale response cannot reopen purchased art");
});

test("scheduled public badges and server filters open without RPC while undeployed drops remain upcoming", async () => {
  const past = new Date(Date.now() - 60000);
  const future = new Date(Date.now() + 60000);
  const opened = await nft({ mintStartTime: past });
  const upcoming = await nft({ mintStartTime: future });
  const undeployed = await nft({ mintStartTime: past, contractAddress: null });
  const live = await (await catalog.GET(new NextRequest(`${origin}/api/items?itemType=NFT&status=LIVE`))).json();
  assert.deepEqual(live.items.map((item: { id: string; status: string }) => [item.id, item.status]), [[opened.id, "LIVE"]]);
  const scheduled = await (await catalog.GET(new NextRequest(`${origin}/api/items?itemType=NFT&status=UPCOMING`))).json();
  assert.deepEqual(new Set(scheduled.items.map((item: { id: string }) => item.id)), new Set([upcoming.id, undeployed.id]));
  assert.equal(reads, 0, "public catalog reads never start per-item RPC work");
});

test("manual status edits cannot reopen deployed NFTs or purchased checkout listings", async () => {
  const item = await nft({ status: "MINTED_OUT", mintedCount: 2 });
  assert.equal((await statusRoute.PATCH(request(`/api/items/${item.id}/status`, { status: "LIVE" }, true, origin, "PATCH"), context(item.id))).status, 409);
  const art = await db.item.create({ data: { creatorId: userId, itemType: "WEB2_ART", title: "Purchased art", artListingId: "7", sold: true } });
  assert.equal((await statusRoute.PATCH(request(`/api/items/${art.id}/status`, { sold: false }, true, origin, "PATCH"), context(art.id))).status, 409);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: art.id } })).sold, true);
});

test("scheduled reconciliation bounds pages and excludes undeployed and unverified imported contracts", async () => {
  const managed = await nft();
  await nft({ contractAddress: null });
  const imported = await nft();
  await db.submission.create({ data: { creatorId: userId, creatorName: "Test", itemType: "NFT", title: "Old unverified import", description: "Imported", imageUrl: "https://example.invalid/image.png", priceUsdc: 0, contractAddress: collection, itemId: imported.id, status: "APPROVED" } });
  await assert.rejects(sync.reconcileCatalogPage({ limit: 101 }));
  const page = await sync.reconcileCatalogPage({ limit: 1 });
  assert.deepEqual(page.results, [{ id: managed.id, ok: true }]);
  assert.equal(page.nextCursor, null);
});

test("an exhausted maintenance budget returns a continuation without starting provider work", async () => {
  await nft();
  const page = await sync.reconcileCatalogPage({ deadline: Date.now() - 1 });
  assert.deepEqual(page.results, []);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, null);
  assert.equal(reads, 0);
});

test("concurrent sync requests cannot create an unbounded RPC queue", async () => {
  const items = await Promise.all(Array.from({ length: 5 }, () => nft()));
  const original = sync.catalogSyncClient.getBlock;
  const rejects: Array<(error: Error) => void> = [];
  Object.assign(sync.catalogSyncClient, { getBlock: () => new Promise((_, reject) => { rejects.push(reject); }) });
  try {
    const pending = items.slice(0, 4).map((item) => sync.reconcileCatalogItem(item));
    const settled = Promise.allSettled(pending);
    await assert.rejects(sync.reconcileCatalogItem(items[4]), sync.CatalogSyncBusyError);
    assert.equal(rejects.length, 4);
    rejects.forEach((reject) => reject(new Error("Provider unavailable")));
    await settled;
  } finally { Object.assign(sync.catalogSyncClient, { getBlock: original }); }
});
