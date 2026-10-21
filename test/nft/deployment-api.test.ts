import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseUnits, toHex, type Address, type Hash } from "viem";

const directory = mkdtempSync(join(tmpdir(), "artiq-deployment-"));
const origin = "http://localhost:3000";
const canonicalOrigin = "https://artiq.example";
const factory = "0x1111111111111111111111111111111111111111" as Address;
const market = "0x2222222222222222222222222222222222222222" as Address;
const owner = "0x3333333333333333333333333333333333333333" as Address;
const other = "0x4444444444444444444444444444444444444444" as Address;
const contract = "0x5555555555555555555555555555555555555555" as Address;
const anotherContract = "0x6666666666666666666666666666666666666666" as Address;
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_APP_ORIGIN = canonicalOrigin;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = "5042002";
process.env.NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS = factory;
process.env.NEXT_PUBLIC_ART_MARKET_ADDRESS = market;

let db: typeof import("../../lib/prisma")["prisma"];
let deployment: typeof import("../../app/api/items/[id]/deployment/route");
let artListing: typeof import("../../app/api/items/[id]/art-listing/route");
let detail: typeof import("../../app/api/items/[id]/route");
let metadata: typeof import("../../app/api/items/[id]/metadata/route");
let mintTime: typeof import("../../app/api/items/[id]/mint-time/route");
let orderRoute: typeof import("../../app/api/items/[id]/order/route");
let rpcChainId = 5042002;
let ownerUserId: string;
let ownerCookie: string;
let otherCookie: string;
let emailCookie: string;
let emailUserId: string;
let reads = 0;
let restore: () => void;
const receipts = new Map<string, Record<string, unknown>>();
const settings = new Map<string, Record<string, unknown>>();
const factoryEvent = parseAbi(["event CollectionCreated(address indexed creator,address indexed collection,uint8 standard,bool soulbound,string name,string symbol)"]);
const listingEvent = parseAbi(["event ArtListed(uint256 indexed listingId,address indexed seller,bytes32 indexed artId,uint256 price)"]);

function hash(): Hash { return `0x${randomBytes(32).toString("hex")}`; }
async function cookie(walletAddress: string) {
  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
  return `artiq_wallet_session=${token}`;
}
function request(path: string, body?: unknown, authentication = "owner", browserOrigin = origin, method = body === undefined ? "GET" : "POST") {
  const login: Record<string, string> = authentication === "owner" ? { Cookie: ownerCookie, "X-Wallet-Address": owner } : authentication === "other" ? { Cookie: otherCookie, "X-Wallet-Address": other } : authentication === "email" ? { Cookie: emailCookie, "X-Artiq-Account-ID": emailUserId } : {};
  return new NextRequest(`${origin}${path}`, { method, headers: { Origin: browserOrigin, ...login, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function nft(overrides: Record<string, unknown> = {}) {
  return db.item.create({ data: { creatorId: ownerUserId, itemType: "NFT", title: "Night study", description: "An approved collection.", imageUrl: "/api/uploads/abcdefghijklmnopqrstuvwx", nftKind: "COLLECTIBLE", symbol: "NIGHT", maxSupply: 50, maxPerWallet: 2, mintPriceUsdc: 2.5, royaltyBps: 500, status: "UPCOMING", attributes: [{ trait_type: "Palette", value: "Blue" }], ...overrides } });
}
function collectionReceipt(item: Awaited<ReturnType<typeof nft>>, address = contract, creator = owner, changes: Record<string, unknown> = {}): Hash {
  const txHash = hash();
  receipts.set(txHash, {
    status: "success", to: factory, from: creator,
    logs: [{ address: factory, topics: encodeEventTopics({ abi: factoryEvent, eventName: "CollectionCreated", args: { creator, collection: address } }), data: encodeAbiParameters([{ type: "uint8" }, { type: "bool" }, { type: "string" }, { type: "string" }], [item.nftKind === "EDITION" ? 2 : 1, item.nftKind === "SOULBOUND", item.title, item.symbol || "ARTIQ"]) }],
    ...changes,
  });
  settings.set(address.toLowerCase(), {
    collectionCreator: creator, owner: creator, mintPrice: parseUnits(String(item.mintPriceUsdc ?? 0), 18),
    mintStartTime: BigInt(item.mintStartTime ? Math.floor(item.mintStartTime.getTime() / 1000) : 0),
    maxSupply: BigInt(item.maxSupply ?? 0), maxPerWallet: BigInt(item.maxPerWallet ?? item.maxSupply ?? 0),
    metadataURI: item.metadataUri || `${canonicalOrigin}/api/items/${item.id}/metadata`,
    royaltyInfo: [creator, BigInt(item.royaltyBps ?? 0)],
  });
  return txHash;
}
function listingReceipt(itemId: string, price = parseUnits("25", 18), seller = owner, listingId = BigInt(1)): Hash {
  const txHash = hash();
  receipts.set(txHash, { status: "success", to: market, from: seller, logs: [{ address: market, topics: encodeEventTopics({ abi: listingEvent, eventName: "ArtListed", args: { listingId, seller, artId: keccak256(toHex(itemId)) } }), data: encodeAbiParameters([{ type: "uint256" }], [price]) }] });
  return txHash;
}

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  ownerUserId = (await db.user.create({ data: { walletAddress: owner, email: "private@example.com", emailVerifiedAt: new Date(), username: "Nia" } })).id;
  await db.user.create({ data: { walletAddress: other } });
  ownerCookie = await cookie(owner); otherCookie = await cookie(other);
  emailUserId = (await db.user.create({ data: { email: "email.creator@example.com", emailVerifiedAt: new Date() } })).id;
  const token = randomBytes(32).toString("hex");
  await db.emailSession.create({ data: { userId: emailUserId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
  emailCookie = `artiq_email_session=${token}`;
  const { deploymentClient } = await import("../../lib/deploymentVerification");
  const originalReceipt = deploymentClient.getTransactionReceipt;
  const originalRead = deploymentClient.readContract;
  const originalChain = deploymentClient.getChainId;
  Object.assign(deploymentClient, {
    getChainId: async () => rpcChainId,
    getTransactionReceipt: async ({ hash: txHash }: { hash: Hash }) => { reads++; const result = receipts.get(txHash); if (!result) throw new Error("Receipt not found"); return result; },
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args?: unknown[] }) => {
      reads++;
      const key = functionName === "collectionCreator" ? String(args?.[0]).toLowerCase() : address.toLowerCase();
      const result = settings.get(key)?.[functionName];
      if (result === undefined) throw new Error("Unexpected contract read");
      return result;
    },
  });
  restore = () => Object.assign(deploymentClient, { getTransactionReceipt: originalReceipt, readContract: originalRead, getChainId: originalChain });
  [deployment, artListing, detail, metadata, mintTime] = await Promise.all([
    import("../../app/api/items/[id]/deployment/route"), import("../../app/api/items/[id]/art-listing/route"),
    import("../../app/api/items/[id]/route"), import("../../app/api/items/[id]/metadata/route"),
    import("../../app/api/items/[id]/mint-time/route"),
  ]);
  orderRoute = await import("../../app/api/items/[id]/order/route");
});
after(async () => { restore?.(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("public detail and token metadata omit private identity and use the configured canonical origin", async () => {
  const item = await nft();
  const anonymous = await detail.GET(request(`/api/items/${item.id}`, undefined, "anonymous"), { params: { id: item.id } });
  assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
  const publicBody = await anonymous.json();
  assert.equal(publicBody.isOwner, false);
  assert.deepEqual(publicBody.item.creator, { walletAddress: owner, username: "Nia" });
  const ownerBody = await (await detail.GET(request(`/api/items/${item.id}`), { params: { id: item.id } })).json();
  assert.equal(ownerBody.isOwner, true);
  const metadataRequest = request(`/api/items/${item.id}/metadata`, undefined, "anonymous");
  metadataRequest.headers.set("host", "attacker.example");
  metadataRequest.headers.set("x-forwarded-host", "attacker.example");
  const token = await metadata.GET(metadataRequest, { params: { id: item.id } });
  assert.deepEqual(await token.json(), { name: item.title, description: item.description, image: `${canonicalOrigin}${item.imageUrl}`, attributes: [{ trait_type: "Palette", value: "Blue" }] });
});

test("deployment rejects wrong origins, anonymous requests, other accounts, and unbound sessions before RPC", async () => {
  const item = await nft();
  const before = reads;
  const payload = { txHash: hash() };
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, payload, "owner", "https://attacker.example"), { params: { id: item.id } })).status, 403);
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, payload, "anonymous"), { params: { id: item.id } })).status, 401);
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, payload, "other"), { params: { id: item.id } })).status, 403);
  const unbound = request(`/api/items/${item.id}/deployment`, payload);
  unbound.headers.set("X-Wallet-Address", other);
  assert.equal((await deployment.POST(unbound, { params: { id: item.id } })).status, 401);
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash: "invalid" }), { params: { id: item.id } })).status, 400);
  assert.equal(reads, before);
});

test("deployment checks successful factory receipts, metadata, mint settings, creator, and royalties", async () => {
  const item = await nft();
  for (const changes of [{ status: "reverted" }, { to: market }, { logs: [] }]) {
    const txHash = collectionReceipt(item, contract, owner, changes);
    assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }), { params: { id: item.id } })).status, 400);
  }
  for (const txHash of [
    collectionReceipt({ ...item, title: "A different collection" }),
    collectionReceipt({ ...item, symbol: "WRONG" }),
    collectionReceipt({ ...item, nftKind: "EDITION" }),
    collectionReceipt({ ...item, nftKind: "SOULBOUND" }),
  ]) assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }), { params: { id: item.id } })).status, 400, "the factory event must identify the approved NFT kind, name, and symbol");
  const spoofedFactoryHash = collectionReceipt(item);
  (receipts.get(spoofedFactoryHash)!.logs as Array<{ address: Address }>)[0].address = other;
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash: spoofedFactoryHash }), { params: { id: item.id } })).status, 400);
  for (const [field, value] of [["metadataURI", "https://attacker.example/metadata.json"], ["mintPrice", BigInt(1)], ["maxSupply", BigInt(51)], ["maxPerWallet", BigInt(3)], ["mintStartTime", BigInt(123)], ["owner", other], ["royaltyInfo", [owner, BigInt(900)]]] as const) {
    const txHash = collectionReceipt(item);
    settings.get(contract.toLowerCase())![field] = value;
    assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }), { params: { id: item.id } })).status, 400, field);
  }
  const foreignWalletTx = collectionReceipt(item, contract, other);
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash: foreignWalletTx }), { params: { id: item.id } })).status, 403);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).contractAddress, null);
});

test("verified deployment is idempotent, protects existing contracts, and resolves concurrent linking once", async () => {
  const item = await nft();
  const firstHash = collectionReceipt(item, contract);
  const secondHash = collectionReceipt(item, anotherContract);
  const responses = await Promise.all([firstHash, secondHash].map((txHash) => deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }), { params: { id: item.id } })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(current.status, "LIVE");
  const winningHash = current.contractAddress?.toLowerCase() === contract.toLowerCase() ? firstHash : secondHash;
  assert.equal((await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash: winningHash }), { params: { id: item.id } })).status, 200);
  const existing = await nft({ contractAddress: market });
  const replacementHash = collectionReceipt(existing);
  assert.equal((await deployment.POST(request(`/api/items/${existing.id}/deployment`, { txHash: replacementHash }), { params: { id: existing.id } })).status, 409);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: existing.id } })).contractAddress, market);
});

test("verified email creators can link a real deployment without inventing a wallet identity", async () => {
  const item = await nft({ creatorId: emailUserId, nftKind: "SOULBOUND", royaltyBps: 0, mintPriceUsdc: 0, maxPerWallet: 1 });
  const txHash = collectionReceipt(item, contract, other);
  const response = await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }, "email"), { params: { id: item.id } });
  assert.equal(response.status, 200);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: emailUserId } })).walletAddress, null);
});

test("only the creator can reschedule an undeployed collection before its opening", async () => {
  const item = await nft({ mintStartTime: new Date(Date.now() + 3_600_000) });
  const payload = { mintStartTime: new Date(Date.now() + 7_200_000).toISOString() };
  const path = `/api/items/${item.id}/mint-time`;
  assert.equal((await mintTime.PATCH(request(path, payload, "anonymous", origin, "PATCH"), { params: { id: item.id } })).status, 401);
  assert.equal((await mintTime.PATCH(request(path, payload, "other", origin, "PATCH"), { params: { id: item.id } })).status, 403);
  assert.equal((await mintTime.PATCH(request(path, payload, "owner", "https://attacker.example", "PATCH"), { params: { id: item.id } })).status, 403);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).mintStartTime?.getTime(), item.mintStartTime?.getTime());
  const response = await mintTime.PATCH(request(path, payload, "owner", origin, "PATCH"), { params: { id: item.id } });
  assert.equal(response.status, 200);
  const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(current.mintStartTime?.toISOString(), payload.mintStartTime);
  assert.equal(current.contractAddress, null);
});

test("deployed and already opened collections keep their mint schedule unchanged", async () => {
  const payload = { mintStartTime: new Date(Date.now() + 7_200_000).toISOString() };
  for (const overrides of [
    { contractAddress: contract, mintStartTime: new Date(Date.now() + 3_600_000) },
    { mintStartTime: new Date(Date.now() - 60_000) },
    { status: "LIVE", mintStartTime: new Date(Date.now() + 3_600_000) },
  ]) {
    const item = await nft(overrides);
    const response = await mintTime.PATCH(request(`/api/items/${item.id}/mint-time`, payload, "owner", origin, "PATCH"), { params: { id: item.id } });
    assert.equal(response.status, 409);
    const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(current.mintStartTime?.getTime(), item.mintStartTime?.getTime());
    assert.equal(current.contractAddress, item.contractAddress);
  }
});

test("mint schedules require a bounded request with a valid future date string", async () => {
  const item = await nft();
  for (const payload of [
    {}, { mintStartTime: null }, { mintStartTime: 1 }, { mintStartTime: [] },
    { mintStartTime: {} }, { mintStartTime: "not a date" },
    { mintStartTime: new Date(Date.now() - 60_000).toISOString() },
    { mintStartTime: "x".repeat(4096) },
  ]) {
    const response = await mintTime.PATCH(request(`/api/items/${item.id}/mint-time`, payload, "owner", origin, "PATCH"), { params: { id: item.id } });
    assert.equal(response.status, 400);
  }
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).mintStartTime, null);
});

test("a deployment linked during rescheduling prevents the stale schedule write", async () => {
  const item = await nft({ mintStartTime: new Date(Date.now() + 3_600_000) });
  const originalUpdateMany = db.item.updateMany;
  let interleaved = false;
  Object.assign(db.item, { updateMany: async (args: Parameters<typeof originalUpdateMany>[0]) => {
    if (!interleaved) {
      interleaved = true;
      await db.item.update({ where: { id: item.id }, data: { contractAddress: contract, updatedAt: new Date(item.updatedAt.getTime() + 1000) } });
    }
    return originalUpdateMany(args);
  } });
  try {
    const response = await mintTime.PATCH(request(`/api/items/${item.id}/mint-time`, { mintStartTime: new Date(Date.now() + 7_200_000).toISOString() }, "owner", origin, "PATCH"), { params: { id: item.id } });
    assert.equal(response.status, 409);
  } finally { Object.assign(db.item, { updateMany: originalUpdateMany }); }
  assert.equal(interleaved, true);
  const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(current.contractAddress, contract);
  assert.equal(current.mintStartTime?.getTime(), item.mintStartTime?.getTime());
});

test("a schedule changed during deployment verification prevents linking the stale contract", async () => {
  const item = await nft({ mintStartTime: new Date(Date.now() + 3_600_000) });
  const txHash = collectionReceipt(item);
  const changedTime = new Date(Date.now() + 7_200_000);
  const originalUpdateMany = db.item.updateMany;
  let interleaved = false;
  Object.assign(db.item, { updateMany: async (args: Parameters<typeof originalUpdateMany>[0]) => {
    if (!interleaved) {
      interleaved = true;
      await db.item.update({ where: { id: item.id }, data: { mintStartTime: changedTime, updatedAt: new Date(item.updatedAt.getTime() + 1000) } });
    }
    return originalUpdateMany(args);
  } });
  try {
    const response = await deployment.POST(request(`/api/items/${item.id}/deployment`, { txHash }), { params: { id: item.id } });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /settings changed/i);
  } finally { Object.assign(db.item, { updateMany: originalUpdateMany }); }
  assert.equal(interleaved, true);
  const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(current.contractAddress, null);
  assert.equal(current.mintStartTime?.getTime(), changedTime.getTime());
});

test("Art listing links require approved artwork, native USDC price, seller ownership, and cannot be replaced", async () => {
  const item = await db.item.create({ data: { creatorId: ownerUserId, itemType: "WEB2_ART", title: "Woven study", priceUsdc: 25, category: "RUG" } });
  const payload = { txHash: hash() };
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, payload, "anonymous"), { params: { id: item.id } })).status, 401);
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, payload, "other"), { params: { id: item.id } })).status, 403);
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, payload, "owner", "https://attacker.example"), { params: { id: item.id } })).status, 403);
  for (const changes of [{ status: "reverted" }, { to: factory }]) {
    const txHash = listingReceipt(item.id);
    Object.assign(receipts.get(txHash)!, changes);
    assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash }), { params: { id: item.id } })).status, 400);
  }
  for (const txHash of [listingReceipt("different-art"), listingReceipt(item.id, BigInt(25_000_000))]) assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash }), { params: { id: item.id } })).status, 400);
  const foreignSeller = listingReceipt(item.id, parseUnits("25", 18), other);
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash: foreignSeller }), { params: { id: item.id } })).status, 403);
  const txHash = listingReceipt(item.id);
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash }), { params: { id: item.id } })).status, 200);
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash }), { params: { id: item.id } })).status, 200);
  const second = listingReceipt(item.id, parseUnits("25", 18), owner, BigInt(2));
  assert.equal((await artListing.POST(request(`/api/items/${item.id}/art-listing`, { txHash: second }), { params: { id: item.id } })).status, 409);
  const current = await db.item.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(current.artListingId, "1");
  assert.equal(current.artListingSeller?.toLowerCase(), owner.toLowerCase());
  assert.equal(current.sold, false, "linking a listing does not fabricate a purchase");
});

const delivery = { recipient: "Test Collector", phone: "+234 800 123 4567", addressLine1: "12 Example Street", addressLine2: "", city: "Lagos", region: "Lagos", postalCode: "100001", country: "Nigeria", instructions: "Call on arrival" };
const purchaseEvent = parseAbi(["event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)"]);
async function purchasedArt() {
  const item = await db.item.create({ data: { creatorId: ownerUserId, itemType: "WEB2_ART", title: "Delivery test", priceUsdc: 25, artListingId: "42", artListingSeller: owner, quantityAvailable: 1 } });
  const txHash = hash();
  const price = parseUnits("25", 18);
  receipts.set(txHash, { status: "success", to: market, from: other, logs: [{ address: market, topics: encodeEventTopics({ abi: purchaseEvent, eventName: "ArtPurchased", args: { listingId: BigInt(42), buyer: other } }), data: encodeAbiParameters([{ type: "uint256" }], [price]) }] });
  settings.set(market.toLowerCase(), { listings: [owner, keccak256(toHex(item.id)), price, other, false] });
  return { item, txHash, params: { params: { id: item.id } } };
}

test("delivery orders require a bound buyer, valid address and same-origin request before RPC", async () => {
  const { item, txHash, params } = await purchasedArt();
  const path = `/api/items/${item.id}/order`;
  const payload = { txHash, delivery };
  const before = reads;
  assert.equal((await orderRoute.POST(request(path, payload, "anonymous"), params)).status, 401);
  assert.equal((await orderRoute.POST(request(path, payload, "other", "https://attacker.example"), params)).status, 403);
  assert.equal((await orderRoute.POST(request(path, payload, "email"), params)).status, 403);
  assert.equal((await orderRoute.POST(request(path, payload, "owner"), params)).status, 403);
  assert.equal((await orderRoute.POST(request(path, { ...payload, delivery: { ...delivery, addressLine1: "" } }, "other"), params)).status, 400);
  assert.equal((await orderRoute.POST(request(path, { ...payload, delivery: { ...delivery, phone: "not-a-phone" } }, "other"), params)).status, 400);
  assert.equal(reads, before);
  assert.equal(await db.artOrder.count({ where: { itemId: item.id } }), 0);
});

test("purchase verification rejects forged, reverted, foreign-chain and unrelated listing receipts", async () => {
  const { item, txHash, params } = await purchasedArt();
  const path = `/api/items/${item.id}/order`;
  const payload = { txHash, delivery };
  const receipt = receipts.get(txHash)!;
  const original = { ...receipt };
  for (const [change, status] of [[{ status: "reverted" }, 400], [{ to: factory }, 400], [{ from: owner }, 403], [{ logs: [] }, 400]] as const) {
    Object.assign(receipt, original, change);
    assert.equal((await orderRoute.POST(request(path, payload, "other"), params)).status, status);
  }
  Object.assign(receipt, original);
  rpcChainId = 1;
  try { assert.equal((await orderRoute.POST(request(path, payload, "other"), params)).status, 400); }
  finally { rpcChainId = 5042002; }
  const listing = settings.get(market.toLowerCase())!.listings as unknown[];
  listing[1] = keccak256(toHex("different-artwork"));
  assert.equal((await orderRoute.POST(request(path, payload, "other"), params)).status, 400);
  assert.equal(await db.artOrder.count({ where: { itemId: item.id } }), 0);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).sold, false);
});

test("confirmed orders are idempotent and delivery stays private to buyer and creator", async () => {
  const { item, txHash, params } = await purchasedArt();
  const path = `/api/items/${item.id}/order`;
  const response = await orderRoute.POST(request(path, { txHash, delivery }, "other"), params);
  assert.equal(response.status, 200);
  const saved = (await response.json()).order;
  assert.deepEqual(saved.delivery, delivery);
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: item.id } })).sold, true);
  assert.equal((await orderRoute.POST(request(path, { txHash, delivery: { ...delivery, city: "Changed" } }, "other"), params)).status, 200);
  assert.equal(await db.artOrder.count({ where: { itemId: item.id } }), 1);
  for (const login of ["owner", "other"]) {
    const result = await orderRoute.GET(request(path, undefined, login), params);
    assert.equal(result.status, 200); assert.deepEqual((await result.json()).order.delivery, delivery);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
  assert.equal((await orderRoute.GET(request(path, undefined, "anonymous"), params)).status, 401);
  const stranger = await orderRoute.GET(request(path, undefined, "email"), params);
  assert.deepEqual(await stranger.json(), { order: null });
  const publicItem = await detail.GET(request(`/api/items/${item.id}`, undefined, "anonymous"), params);
  assert.ok(!JSON.stringify(await publicItem.json()).includes(delivery.addressLine1));
});
