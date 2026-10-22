import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseUnits, zeroAddress, type Address, type Hash } from "viem";

const directory = mkdtempSync(join(tmpdir(), "artiq-asset-auction-"));
const origin = "http://localhost:3000";
const market = "0x1111111111111111111111111111111111111111" as Address;
const nextMarket = "0x2222222222222222222222222222222222222222" as Address;
const seller = "0x3333333333333333333333333333333333333333" as Address;
const winner = "0x4444444444444444444444444444444444444444" as Address;
const stranger = "0x5555555555555555555555555555555555555555" as Address;
const privateDownload = "https://downloads.example/secret-winner-only?token=private-token";
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS = market;

let db: typeof import("../../lib/prisma")["prisma"];
let routes: typeof import("../../app/api/asset-auctions/route");
let detail: typeof import("../../app/api/asset-auctions/[id]/route");
let activate: typeof import("../../app/api/asset-auctions/[id]/activate/route");
let fulfillment: typeof import("../../app/api/asset-auctions/[id]/fulfillment/route");
let uploads: typeof import("../../app/api/uploads/[id]/route");
let protocol: typeof import("../../lib/protocol")["protocol"];
let sellerUser: string;
let winnerUser: string;
let cover: string;
let foreignCover: string;
let reads = 0;
let rpcChainId = 5042002;
let nextId = 1;
let restore: () => void;
const cookies = new Map<string, string>();
const receipts = new Map<string, Record<string, unknown>>();
const states = new Map<string, unknown[]>();
const assets = new Map<string, unknown[]>();
const creationEvent = parseAbi(["event AssetAuctionCreated(uint256 indexed auctionId,address indexed seller,bytes32 indexed assetKey,uint8 assetKind,uint256 reservePrice,uint64 endsAt)"]);
const shipping = { recipient: "Test Collector", phone: "+234 800 123 4567", addressLine1: "12 Private Street", addressLine2: "", city: "Lagos", region: "Lagos", postalCode: "100001", country: "Nigeria", instructions: "Call on arrival" };
type Auction = Awaited<ReturnType<typeof draft>>;

function hash(): Hash { return `0x${randomBytes(32).toString("hex")}`; }
function request(path: string, body?: unknown, wallet: string | null = seller, requestOrigin = origin) {
  return new NextRequest(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: {
    Origin: requestOrigin, ...(wallet ? { Cookie: cookies.get(wallet) || "", "X-Wallet-Address": wallet } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const context = (id: string) => ({ params: { id } });
function payload(kind = "DIGITAL", changes: Record<string, unknown> = {}) {
  return { kind, title: "A signed original study", description: "A complete original work from my studio.", imageUrl: `/api/uploads/${cover}`, deliveryTerms: kind === "DIGITAL" ? "Download includes the source file and personal display rights." : "Ships to Nigeria; postage is included in the winning bid.", reservePrice: "2.500000", endsAt: new Date(Date.now() + 3_600_000).toISOString(), ...(kind === "DIGITAL" ? { digitalDeliveryUrl: privateDownload } : {}), ...changes };
}
async function draft(kind = "DIGITAL") {
  const response = await routes.POST(request("/api/asset-auctions", payload(kind)));
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return db.assetAuction.findUniqueOrThrow({ where: { id: body.auction.id } });
}
function receipt(auction: Auction, overrides: Record<string, unknown> = {}) {
  const txHash = hash();
  const auctionId = BigInt(nextId++);
  const reserve = parseUnits(auction.reservePrice, 18);
  const ends = BigInt(Math.floor(auction.endsAt.getTime() / 1000));
  const assetKind = auction.kind === "DIGITAL" ? 1 : 2;
  receipts.set(txHash, { status: "success", to: auction.marketAddress, from: seller, logs: [{ address: auction.marketAddress,
    topics: encodeEventTopics({ abi: creationEvent, eventName: "AssetAuctionCreated", args: { auctionId, seller, assetKey: auction.assetKey as Hash } }),
    data: encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "uint64" }], [assetKind, reserve, ends]),
  }], ...overrides });
  states.set(String(auctionId), [seller, zeroAddress, BigInt(0), reserve, zeroAddress, BigInt(0), ends, false, false]);
  assets.set(String(auctionId), [auction.assetKey, assetKind]);
  return { txHash, auctionId: String(auctionId) };
}
async function publish(auction: Auction) {
  const { txHash, auctionId } = receipt(auction);
  const response = await activate.POST(request(`/api/asset-auctions/${auction.id}/activate`, { txHash }), context(auction.id));
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  return { txHash, auctionId };
}

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  sellerUser = (await db.user.create({ data: { walletAddress: seller, username: "Private Seller", email: "hidden-seller@example.com" } })).id;
  winnerUser = (await db.user.create({ data: { walletAddress: winner } })).id;
  await db.user.create({ data: { walletAddress: stranger } });
  for (const wallet of [seller, winner, stranger]) {
    const token = randomBytes(32).toString("hex");
    await db.walletSession.create({ data: { walletAddress: wallet, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
    cookies.set(wallet, `artiq_wallet_session=${token}`);
  }
  const image = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71]), byteSize: 4 };
  cover = (await db.uploadedImage.create({ data: { ...image, ownerUserId: sellerUser, ownerWallet: seller } })).id;
  foreignCover = (await db.uploadedImage.create({ data: { ...image, ownerUserId: winnerUser, ownerWallet: winner } })).id;
  const { deploymentClient } = await import("../../lib/deploymentVerification");
  const originals = { getChainId: deploymentClient.getChainId, getTransactionReceipt: deploymentClient.getTransactionReceipt, readContract: deploymentClient.readContract };
  Object.assign(deploymentClient, {
    getChainId: async () => rpcChainId,
    getTransactionReceipt: async ({ hash: txHash }: { hash: Hash }) => { reads++; const result = receipts.get(txHash); if (!result) throw new Error("Missing receipt"); return result; },
    readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      reads++; const id = String(args[0]);
      const result = functionName === "auctions" ? states.get(id) : functionName === "auctionAssets" ? assets.get(id) : undefined;
      if (!result) throw new Error("Missing contract state"); return result;
    },
  });
  restore = () => Object.assign(deploymentClient, originals);
  [routes, detail, activate, fulfillment, uploads] = await Promise.all([
    import("../../app/api/asset-auctions/route"), import("../../app/api/asset-auctions/[id]/route"),
    import("../../app/api/asset-auctions/[id]/activate/route"), import("../../app/api/asset-auctions/[id]/fulfillment/route"),
    import("../../app/api/uploads/[id]/route"),
  ]);
  ({ protocol } = await import("../../lib/protocol"));
});
after(async () => { restore?.(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("auction creation requires a bound wallet, owned cover, exact USDC, bounded timer and private HTTPS download", async () => {
  const beforeReads = reads;
  assert.equal((await routes.POST(request("/api/asset-auctions", payload(), null))).status, 401);
  assert.equal((await routes.POST(request("/api/asset-auctions", payload(), seller, "https://attacker.example"))).status, 403);
  const unbound = request("/api/asset-auctions", payload()); unbound.headers.set("X-Wallet-Address", winner);
  assert.equal((await routes.POST(unbound)).status, 401);
  assert.equal((await routes.POST(request("/api/asset-auctions", payload("DIGITAL", { imageUrl: `/api/uploads/${foreignCover}` })))).status, 403);
  for (const changes of [
    { kind: "NFT" }, { imageUrl: "https://attacker.example/image.png" }, { reservePrice: "0" },
    { reservePrice: "0.0000001" }, { endsAt: new Date(Date.now() - 1000).toISOString() },
    { endsAt: new Date(Date.now() + 31 * 86_400_000).toISOString() }, { digitalDeliveryUrl: "http://example.com/file" },
    { digitalDeliveryUrl: "https://username:password@example.com/file" },
  ]) assert.equal((await routes.POST(request("/api/asset-auctions", payload("DIGITAL", changes)))).status, 400, JSON.stringify(changes));
  assert.equal(reads, beforeReads);
  const auction = await draft();
  assert.equal(auction.reservePrice, "2.5");
  assert.equal(auction.endsAt.getMilliseconds(), 0);
  assert.equal(auction.digitalDeliveryUrl, privateDownload);
});

test("drafts and their covers stay private, while public auction projections omit all fulfillment and account details", async () => {
  const auction = await draft();
  assert.equal((await detail.GET(request(`/api/asset-auctions/${auction.id}`, undefined, null), context(auction.id))).status, 404);
  assert.equal((await detail.GET(request(`/api/asset-auctions/${auction.id}`, undefined, winner), context(auction.id))).status, 404);
  const owned = await (await detail.GET(request(`/api/asset-auctions/${auction.id}`), context(auction.id))).json();
  assert.equal(owned.auction.isOwner, true);
  assert.equal(JSON.stringify(owned).includes(privateDownload), false);
  assert.equal((await uploads.GET(request(`/api/uploads/${cover}`, undefined, null), context(cover))).status, 404);
  assert.equal((await uploads.GET(request(`/api/uploads/${cover}`), context(cover))).status, 200);
  assert.equal((await routes.GET(request("/api/asset-auctions?mine=1", undefined, null))).status, 401);
  assert.equal((await routes.GET(request("/api/asset-auctions?kind=NFT"))).status, 400);
  assert.equal((await routes.GET(request("/api/asset-auctions?page=0"))).status, 400);
  const beforeList = await (await routes.GET(request("/api/asset-auctions", undefined, null))).json();
  assert.equal(beforeList.auctions.some((row: { id: string }) => row.id === auction.id), false);
  await publish(auction);
  const result = await (await routes.GET(request("/api/asset-auctions", undefined, null))).json();
  const publicRow = result.auctions.find((row: { id: string }) => row.id === auction.id);
  assert.ok(publicRow);
  for (const field of ["sellerId", "digitalDeliveryUrl", "delivery", "winnerWallet", "email", "walletAddresses"]) assert.equal(field in publicRow, false, field);
  assert.equal(JSON.stringify(result).includes("hidden-seller@example.com"), false);
  assert.equal((await uploads.GET(request(`/api/uploads/${cover}`, undefined, null), context(cover))).status, 200);
});

test("activation verifies wallet, chain, trusted receipt, public commitment, kind, reserve, deadline and on-chain asset state", async () => {
  const auction = await draft();
  const path = `/api/asset-auctions/${auction.id}/activate`;
  const { txHash, auctionId } = receipt(auction);
  const beforeReads = reads;
  assert.equal((await activate.POST(request(path, { txHash }, winner), context(auction.id))).status, 403);
  assert.equal((await activate.POST(request(path, { txHash }, null), context(auction.id))).status, 401);
  assert.equal((await activate.POST(request(path, { txHash }, seller, "https://attacker.example"), context(auction.id))).status, 403);
  assert.equal((await activate.POST(request(path, { txHash: "invalid" }), context(auction.id))).status, 400);
  assert.equal(reads, beforeReads);
  const originalReceipt = { ...receipts.get(txHash)! };
  for (const changes of [{ status: "reverted" }, { to: nextMarket }, { from: stranger }, { logs: [] }]) {
    Object.assign(receipts.get(txHash)!, originalReceipt, changes);
    assert.equal((await activate.POST(request(path, { txHash }), context(auction.id))).status, 400, JSON.stringify(changes));
  }
  Object.assign(receipts.get(txHash)!, originalReceipt);
  rpcChainId = 1;
  assert.equal((await activate.POST(request(path, { txHash }), context(auction.id))).status, 400);
  rpcChainId = 5042002;
  const originalAsset = [...assets.get(auctionId)!];
  assets.set(auctionId, [hash(), 2]);
  assert.equal((await activate.POST(request(path, { txHash }), context(auction.id))).status, 400);
  assets.set(auctionId, originalAsset);
  const state = states.get(auctionId)!;
  state[3] = BigInt(2_500_000);
  assert.equal((await activate.POST(request(path, { txHash }), context(auction.id))).status, 400);
  state[3] = parseUnits("2.5", 18);
  const response = await activate.POST(request(path, { txHash }), context(auction.id));
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal((await activate.POST(request(path, { txHash }), context(auction.id))).status, 200);
  const replacement = receipt(auction);
  assert.equal((await activate.POST(request(path, { txHash: replacement.txHash }), context(auction.id))).status, 409);
  const current = await db.assetAuction.findUniqueOrThrow({ where: { id: auction.id } });
  assert.equal(current.auctionId, auctionId);
  assert.equal(current.activationTxHash, txHash);
});

test("original pinned auction houses remain valid after configured-house rotation", async () => {
  const auction = await draft("PHYSICAL");
  const { txHash } = receipt(auction);
  const oldLegacy = protocol.legacyAuctions;
  protocol.auctions = nextMarket;
  protocol.legacyAuctions = [market];
  try {
    const response = await activate.POST(request(`/api/asset-auctions/${auction.id}/activate`, { txHash }), context(auction.id));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const current = await db.assetAuction.findUniqueOrThrow({ where: { id: auction.id } });
    assert.equal(current.marketAddress, market);
  } finally { protocol.auctions = market; protocol.legacyAuctions = oldLegacy; }
});

test("digital files unlock only for the verified settled winner and never through public views or seller fulfillment", async () => {
  const auction = await draft();
  const { auctionId } = await publish(auction);
  const path = `/api/asset-auctions/${auction.id}/fulfillment`;
  const state = states.get(auctionId)!;
  state[4] = winner; state[5] = parseUnits("10", 18);
  assert.equal((await fulfillment.GET(request(path, undefined, winner), context(auction.id))).status, 403);
  assert.equal((await fulfillment.GET(request(path, undefined, null), context(auction.id))).status, 401);
  state[7] = true;
  assert.equal((await fulfillment.GET(request(path, undefined, stranger), context(auction.id))).status, 403);
  const sellerResponse = await (await fulfillment.GET(request(path), context(auction.id))).json();
  assert.equal(sellerResponse.digitalDeliveryUrl, null);
  const winnerResponse = await fulfillment.GET(request(path, undefined, winner), context(auction.id));
  assert.equal(winnerResponse.headers.get("cache-control"), "private, no-store");
  assert.equal((await winnerResponse.json()).digitalDeliveryUrl, privateDownload);
  const publicDetails = await (await detail.GET(request(`/api/asset-auctions/${auction.id}`, undefined, null), context(auction.id))).json();
  assert.equal(JSON.stringify(publicDetails).includes(privateDownload), false);
});

test("physical winner delivery is private, validated and idempotent, and no-bid cancellations unlock no fulfillment", async () => {
  const auction = await draft("PHYSICAL");
  const { auctionId } = await publish(auction);
  const path = `/api/asset-auctions/${auction.id}/fulfillment`;
  const state = states.get(auctionId)!;
  state[7] = true;
  assert.equal((await fulfillment.POST(request(path, { delivery: shipping }, winner), context(auction.id))).status, 403);
  state[4] = winner; state[5] = parseUnits("20", 18);
  assert.equal((await fulfillment.POST(request(path, { delivery: shipping }), context(auction.id))).status, 403);
  assert.equal((await fulfillment.POST(request(path, { delivery: { ...shipping, phone: "bad" } }, winner), context(auction.id))).status, 400);
  assert.equal((await fulfillment.POST(request(path, { delivery: shipping }, winner, "https://attacker.example"), context(auction.id))).status, 403);
  const first = await fulfillment.POST(request(path, { delivery: shipping }, winner), context(auction.id));
  assert.equal(first.status, 200); assert.deepEqual((await first.json()).delivery, shipping);
  const retry = await fulfillment.POST(request(path, { delivery: { ...shipping, city: "Changed city" } }, winner), context(auction.id));
  assert.deepEqual((await retry.json()).delivery, shipping);
  assert.deepEqual((await (await fulfillment.GET(request(path), context(auction.id))).json()).delivery, shipping);
  assert.equal((await fulfillment.GET(request(path, undefined, stranger), context(auction.id))).status, 403);
  const publicListing = await (await routes.GET(request("/api/asset-auctions?kind=PHYSICAL", undefined, null))).json();
  assert.equal(JSON.stringify(publicListing).includes(shipping.addressLine1), false);
  const saved = await db.assetAuction.findUniqueOrThrow({ where: { id: auction.id } });
  assert.equal(saved.winnerWallet, winner);
  assert.deepEqual(saved.delivery, shipping);
});
