import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Every query uses this disposable database. RPC calls below are replaced in
// this process only; no email, chain transaction, or real funds are involved.
const directory = mkdtempSync(join(tmpdir(), "artiq-testers-"));
const origin = "http://localhost:3000";
const canonicalOrigin = "https://artiq.example";
const chainId = 5042002;
const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"02".repeat(32)}`);
const owner = account.address.toLowerCase() as Address;
const other = otherAccount.address.toLowerCase() as Address;
const reviewer = "0x9999999999999999999999999999999999999999" as Address;
const factory = "0x1111111111111111111111111111111111111111" as Address;
const market = "0x2222222222222222222222222222222222222222" as Address;
const auctions = "0x3333333333333333333333333333333333333333" as Address;
const collection = "0x4444444444444444444444444444444444444444" as Address;
process.env.DATABASE_URL = `file:${join(directory, "test.db")}`;
process.env.ARTIQ_APP_ORIGIN = canonicalOrigin;
process.env.NEXT_PUBLIC_ARC_CHAIN_ID = String(chainId);
process.env.NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS = factory;
process.env.NEXT_PUBLIC_ART_MARKET_ADDRESS = market;
process.env.NEXT_PUBLIC_AUCTION_HOUSE_ADDRESS = auctions;
process.env.ARTIQ_ADMIN_WALLETS = reviewer;
process.env.ARTIQ_ADMIN_EMAILS = "reviewer@example.com";
delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
delete process.env.PRIVY_APP_ID;
process.env.GMAIL_SMTP_USER = "test.sender@gmail.com";
process.env.GMAIL_SMTP_APP_PASSWORD = "abcdefghijklmnop";
process.env.ARTIQ_EMAIL_CODE_SECRET = "01".repeat(32);

type Login = { userId: string; cookie: string; walletAddress?: Address };
let db: typeof import("../../lib/prisma")["prisma"];
let board: typeof import("../../lib/testerLeaderboard");
let rules: typeof import("../../lib/testerPoints");
let publicRoute: typeof import("../../app/api/leaderboard/route");
let meRoute: typeof import("../../app/api/leaderboard/me/route");
let activityRoute: typeof import("../../app/api/tester/activity/route");
let nonceRoute: typeof import("../../app/api/auth/nonce/route");
let walletVerify: typeof import("../../app/api/auth/verify/route");
let emailVerify: typeof import("../../app/api/auth/email/verify/route");
let reviewRoute: typeof import("../../app/api/admin/submissions/[id]/route");
let restoreRpc: (() => void) | undefined;
let rpcChainId = chainId;
let failRpc = false;
let reads = 0;
const receipts = new Map<string, Record<string, unknown>>();
const registeredCollections = new Map<string, Address>();
const events = parseAbi([
  "event MintActivityRecorded(address indexed minter,address indexed collection)",
  "event CollectionCreated(address indexed creator,address indexed collection,uint8 standard,bool soulbound,string name,string symbol)",
  "event ArtPurchased(uint256 indexed listingId,address indexed buyer,uint256 price)",
  "event BidPlaced(uint256 indexed auctionId,address indexed bidder,uint256 amount)",
  "event RewardJoined(uint256 indexed roundId,address indexed participant,uint32 position)",
  "event RewardClaimed(uint256 indexed roundId,address indexed participant,address indexed receiver,uint256 amount)",
]);

function hash(): Hash { return `0x${randomBytes(32).toString("hex")}`; }
function request(path: string, body?: unknown, login?: Login, browserOrigin = origin) {
  return new NextRequest(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: browserOrigin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(login ? { Cookie: login.cookie, ...(login.walletAddress ? { "X-Wallet-Address": login.walletAddress } : { "X-Artiq-Account-ID": login.userId }) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function walletLogin(walletAddress: Address = owner, profile = true): Promise<Login> {
  const user = await db.user.upsert({ where: { walletAddress }, update: {}, create: { walletAddress } });
  const token = randomBytes(32).toString("hex");
  await db.walletSession.create({ data: { walletAddress, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  if (profile) await board.ensureTesterProfile(db, user.id);
  return { userId: user.id, walletAddress, cookie: `artiq_wallet_session=${token}` };
}
async function emailLogin(email = "tester@example.com", profile = true): Promise<Login> {
  const user = await db.user.upsert({ where: { email }, update: { emailVerifiedAt: new Date() }, create: { email, emailVerifiedAt: new Date() } });
  const token = randomBytes(32).toString("hex");
  await db.emailSession.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  if (profile) await board.ensureTesterProfile(db, user.id);
  return { userId: user.id, cookie: `artiq_email_session=${token}` };
}
async function milestoneKinds(userId: string) {
  const profile = await db.testerProfile.findUniqueOrThrow({ where: { userId }, include: { milestones: true } });
  return profile.milestones.map((milestone) => milestone.kind).sort();
}
async function mine(login: Login) {
  const response = await meRoute.GET(request("/api/leaderboard/me", undefined, login));
  assert.equal(response.status, 200);
  return (await response.json()).tester;
}
function proofMessage(userId: string, txHash: Hash) {
  return `Artiq tester activity\nAccount: ${userId}\nChain: ${chainId}\nTransaction: ${txHash.toLowerCase()}`;
}

type ChainKind = "DEPLOY_COLLECTION" | "MINT_NFT" | "BUY_ART" | "PLACE_BID" | "JOIN_REWARD" | "CLAIM_REWARD";
function activityReceipt(kind: ChainKind, wallet: Address = owner, overrides: Record<string, unknown> = {}): Hash {
  const txHash = hash();
  let target = auctions;
  let log: { address: Address; topics: ReturnType<typeof encodeEventTopics>; data: Hash };
  if (kind === "DEPLOY_COLLECTION") {
    target = factory;
    log = { address: factory, topics: encodeEventTopics({ abi: events, eventName: "CollectionCreated", args: { creator: wallet, collection } }), data: encodeAbiParameters([{ type: "uint8" }, { type: "bool" }, { type: "string" }, { type: "string" }], [1, false, "Study", "ART"]) };
  } else if (kind === "MINT_NFT") {
    target = collection;
    const mintAbi = parseAbi(["event Minted(address indexed to,uint256 quantity,uint256 firstTokenId,uint256 totalPaid)"]);
    log = { address: collection, topics: encodeEventTopics({ abi: mintAbi, eventName: "Minted", args: { to: wallet } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [BigInt(1), BigInt(1), BigInt(2)]) };
  } else if (kind === "BUY_ART") {
    target = market;
    log = { address: market, topics: encodeEventTopics({ abi: events, eventName: "ArtPurchased", args: { listingId: BigInt(1), buyer: wallet } }), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(25)]) };
  } else if (kind === "PLACE_BID") {
    log = { address: auctions, topics: encodeEventTopics({ abi: events, eventName: "BidPlaced", args: { auctionId: BigInt(1), bidder: wallet } }), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(10)]) };
  } else if (kind === "JOIN_REWARD") {
    log = { address: auctions, topics: encodeEventTopics({ abi: events, eventName: "RewardJoined", args: { roundId: BigInt(1), participant: wallet } }), data: encodeAbiParameters([{ type: "uint32" }], [1]) };
  } else {
    log = { address: auctions, topics: encodeEventTopics({ abi: events, eventName: "RewardClaimed", args: { roundId: BigInt(1), participant: wallet, receiver: wallet } }), data: encodeAbiParameters([{ type: "uint256" }], [BigInt(5)]) };
  }
  receipts.set(txHash, { status: "success", from: wallet, to: target, logs: [log], ...overrides });
  return txHash;
}
async function approvedCollection(creatorId: string) {
  registeredCollections.set(collection.toLowerCase(), owner);
  return db.item.create({ data: { creatorId, itemType: "NFT", title: "Approved collection", contractAddress: collection, nftKind: "COLLECTIBLE", status: "LIVE", maxSupply: 10, mintPriceUsdc: 1 } });
}

before(async () => {
  writeFileSync(join(directory, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  [board, rules, publicRoute, meRoute, activityRoute, nonceRoute, walletVerify, emailVerify, reviewRoute] = await Promise.all([
    import("../../lib/testerLeaderboard"), import("../../lib/testerPoints"), import("../../app/api/leaderboard/route"),
    import("../../app/api/leaderboard/me/route"), import("../../app/api/tester/activity/route"),
    import("../../app/api/auth/nonce/route"), import("../../app/api/auth/verify/route"),
    import("../../app/api/auth/email/verify/route"), import("../../app/api/admin/submissions/[id]/route"),
  ]);
  const { deploymentClient } = await import("../../lib/deploymentVerification");
  const original = { getTransactionReceipt: deploymentClient.getTransactionReceipt, getChainId: deploymentClient.getChainId, readContract: deploymentClient.readContract };
  Object.assign(deploymentClient, {
    getChainId: async () => { reads++; if (failRpc) throw new Error("Temporary test RPC failure"); return rpcChainId; },
    getTransactionReceipt: async ({ hash: txHash }: { hash: Hash }) => {
      reads++;
      if (failRpc) throw new Error("Temporary test RPC failure");
      const receipt = receipts.get(txHash.toLowerCase());
      if (!receipt) throw new Error("Transaction receipt unavailable");
      return receipt;
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      reads++;
      if (failRpc) throw new Error("Temporary test RPC failure");
      if (functionName === "collectionCreator") return registeredCollections.get(String(args?.[0]).toLowerCase()) ?? zeroAddress;
      throw new Error(`Unexpected contract read: ${functionName}`);
    },
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
  await db.emailSession.deleteMany();
  await db.walletSession.deleteMany();
  await db.emailChallenge.deleteMany();
  await db.walletChallenge.deleteMany();
  await db.user.deleteMany();
  receipts.clear(); registeredCollections.clear(); rpcChainId = chainId; failRpc = false; reads = 0;
});
after(async () => { restoreRpc?.(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test("only verified sign-ins count as testers and returning accounts are counted once", async () => {
  await db.user.create({ data: { walletAddress: other, username: "Seeded artist" } });
  await db.user.create({ data: { email: "unverified@example.com" } });
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 0);

  const response = await nonceRoute.POST(request("/api/auth/nonce", { walletAddress: owner }));
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 0, "requesting a signature does not count as joining");
  const invalid = await otherAccount.signMessage({ message: challenge.message });
  assert.equal((await walletVerify.POST(request("/api/auth/verify", { walletAddress: owner, nonce: challenge.nonce, signature: invalid }))).status, 401);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 0);
  const signature = await account.signMessage({ message: challenge.message });
  assert.equal((await walletVerify.POST(request("/api/auth/verify", { walletAddress: owner, nonce: challenge.nonce, signature }))).status, 200);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 1);

  const again = await (await nonceRoute.POST(request("/api/auth/nonce", { walletAddress: owner }))).json();
  assert.equal((await walletVerify.POST(request("/api/auth/verify", { walletAddress: owner, nonce: again.nonce, signature: await account.signMessage({ message: again.message }) }))).status, 200);
  const user = await db.user.findUniqueOrThrow({ where: { walletAddress: owner } });
  assert.deepEqual(await milestoneKinds(user.id), ["SIGN_IN"]);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 1);

  const { hashEmailCode } = await import("../../lib/emailAuth");
  const challengeId = randomBytes(24).toString("hex");
  const email = "verified@example.com";
  const code = "123456";
  await db.emailChallenge.create({ data: { id: challengeId, email, origin, codeHash: hashEmailCode({ challengeId, email, origin, code }), delivered: true, expiresAt: new Date(Date.now() + 60_000) } });
  assert.equal((await emailVerify.POST(request("/api/auth/email/verify", { email, challengeId, code }))).status, 200);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 2);
  const verified = await db.user.findUniqueOrThrow({ where: { email } });
  assert.deepEqual(await milestoneKinds(verified.id), ["SIGN_IN"]);
});

test("server milestone awards are idempotent and the score is capped at the published first-task total", async () => {
  const login = await emailLogin();
  for (const rule of rules.TESTER_POINT_RULES) {
    await board.awardTesterMilestone(db, login.userId, rule.kind);
    await board.awardTesterMilestone(db, login.userId, rule.kind);
  }
  const tester = await mine(login);
  assert.equal(tester.points, 165);
  assert.equal(tester.points, rules.MAX_TESTER_POINTS);
  assert.equal(tester.milestones.length, rules.TESTER_POINT_RULES.length);
  assert.equal(new Set(tester.milestones.map((entry: { kind: string }) => entry.kind)).size, tester.milestones.length);
  await board.ensureTesterProfile(db, login.userId);
  assert.equal((await mine(login)).points, 165);
});

test("pagination has stable ranks and ties use verified joining time then the public tester ID", async () => {
  const joined = new Date("2026-01-01T00:00:00Z");
  const ids: string[] = [];
  const profileIds: string[] = [];
  for (let index = 0; index < 5; index++) {
    const login = await emailLogin(`tie-${index}@example.com`);
    ids.push(login.userId);
    profileIds.push((await db.testerProfile.findUniqueOrThrow({ where: { userId: login.userId } })).id);
    await db.user.update({ where: { id: login.userId }, data: { username: `Tester ${index}` } });
    await db.testerProfile.update({ where: { userId: login.userId }, data: { joinedAt: new Date(joined.getTime() + Math.max(0, index - 1) * 1000) } });
  }
  await board.awardTesterMilestone(db, ids[4], "APPROVED_CREATOR");
  const first = await (await publicRoute.GET(request("/api/leaderboard?page=1&pageSize=2"))).json();
  const second = await (await publicRoute.GET(request("/api/leaderboard?page=2&pageSize=2"))).json();
  const third = await (await publicRoute.GET(request("/api/leaderboard?page=3&pageSize=2"))).json();
  assert.deepEqual([...first.entries, ...second.entries, ...third.entries].map((entry) => entry.id), [profileIds[4], ...profileIds.slice(0, 2).sort(), ...profileIds.slice(2, 4)]);
  assert.deepEqual([...first.entries, ...second.entries, ...third.entries].map((entry) => entry.rank), [1, 2, 3, 4, 5]);
  assert.equal(first.pagination.totalEntries, 5);
  assert.equal(first.pagination.totalPages, 3);
  const repeated = await (await publicRoute.GET(request("/api/leaderboard?page=2&pageSize=2"))).json();
  assert.deepEqual(repeated.entries, second.entries);
});

test("public statistics and rows omit private identities and unreviewed application details", async () => {
  const email = await emailLogin("private-email@example.com");
  const wallet = await walletLogin();
  await db.user.update({ where: { id: email.userId }, data: { username: "Public artist" } });
  await db.submission.create({ data: { creatorId: email.userId, creatorName: "Private legal name", contactEmail: "private-contact@example.com", itemType: "NFT", title: "PRIVATE_PENDING_TITLE", description: "PRIVATE_DESCRIPTION", imageUrl: "/api/uploads/private-image", priceUsdc: 1, status: "PENDING", reviewNote: "PRIVATE_REVIEW_NOTE" } });
  const response = await publicRoute.GET(request("/api/leaderboard"));
  assert.equal(response.status, 200);
  const body = await response.json();
  const serialized = JSON.stringify(body);
  for (const value of ["private-email@example.com", "private-contact@example.com", email.userId, wallet.userId, owner, "PRIVATE_PENDING_TITLE", "PRIVATE_DESCRIPTION", "Private legal name", "private-image", "PRIVATE_REVIEW_NOTE"]) assert.ok(!serialized.toLowerCase().includes(value.toLowerCase()), `public leaderboard leaked ${value}`);
  assert.equal(body.stats.totalUsers, 2);
  assert.equal(body.stats.activeTesters7d, 2);
  assert.equal(body.stats.totalPoints, 20);
  assert.ok(body.entries.every((entry: { displayName: string }) => /^Tester [A-Z0-9]{8}$/.test(entry.displayName)), "the leaderboard uses anonymous tester aliases");
  assert.ok(body.entries.every((entry: { points: number }) => entry.points === 10));
});

test("active tester count uses recent server activity and excludes old profiles", async () => {
  const old = await emailLogin("old@example.com");
  await emailLogin("recent@example.com");
  await db.testerProfile.update({ where: { userId: old.userId }, data: { lastActiveAt: new Date(Date.now() - 8 * 24 * 60 * 60_000) } });
  const stats = (await board.getTesterLeaderboard({})).stats;
  assert.equal(stats.totalUsers, 2);
  assert.equal(stats.activeTesters7d, 1);
  await board.ensureTesterProfile(db, old.userId);
  assert.equal((await board.getTesterLeaderboard({})).stats.activeTesters7d, 2);
  assert.equal((await board.getTesterEntry(old.userId))?.points, 10);
});

test("my rank requires the signed account header and cannot be selected by a query or body identity", async () => {
  const login = await emailLogin();
  const otherLogin = await emailLogin("other@example.com");
  await board.awardTesterMilestone(db, otherLogin.userId, "APPROVED_CREATOR");
  assert.equal((await meRoute.GET(request("/api/leaderboard/me"))).status, 401);
  const unbound = request("/api/leaderboard/me", undefined, login);
  unbound.headers.delete("x-artiq-account-id");
  assert.equal((await meRoute.GET(unbound)).status, 401);
  const forged = request("/api/leaderboard/me", undefined, login);
  forged.headers.set("x-artiq-account-id", otherLogin.userId);
  assert.equal((await meRoute.GET(forged)).status, 401);
  const response = await meRoute.GET(request(`/api/leaderboard/me?userId=${otherLogin.userId}`, undefined, login));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).tester.points, 10);
  const wallet = await walletLogin();
  const wrongWallet = request("/api/leaderboard/me", undefined, wallet);
  wrongWallet.headers.set("x-wallet-address", other);
  assert.equal((await meRoute.GET(wrongWallet)).status, 401);
});

test("creator milestone is awarded only after approval and cannot be farmed with repeat submissions", async () => {
  const login = await emailLogin();
  const admin = await emailLogin("reviewer@example.com");
  async function submission(title: string) {
    return db.submission.create({ data: { creatorId: login.userId, creatorName: "Creator", itemType: "NFT", title, description: "A submitted NFT collection.", imageUrl: "https://example.com/art.png", priceUsdc: 1, maxSupply: 5, nftKind: "COLLECTIBLE" } });
  }
  const rejected = await submission("Rejected study");
  assert.equal((await mine(login)).points, 10);
  const rejection = request(`/api/admin/submissions/${rejected.id}`, { decision: "REJECTED", reviewNote: "Please provide clearer metadata." }, admin);
  const rejectRequest = new NextRequest(rejection.url, { method: "PATCH", headers: rejection.headers, body: await rejection.text() });
  assert.equal((await reviewRoute.PATCH(rejectRequest, { params: { id: rejected.id } })).status, 200);
  assert.equal((await mine(login)).points, 10);
  for (const title of ["Approved study one", "Approved study two"]) {
    const pending = await submission(title);
    const approval = request(`/api/admin/submissions/${pending.id}`, { decision: "APPROVED" }, admin);
    const approveRequest = new NextRequest(approval.url, { method: "PATCH", headers: approval.headers, body: await approval.text() });
    assert.equal((await reviewRoute.PATCH(approveRequest, { params: { id: pending.id } })).status, 200);
  }
  assert.equal((await mine(login)).points, 35);
  assert.deepEqual(await milestoneKinds(login.userId), ["APPROVED_CREATOR", "SIGN_IN"]);
});

test("successful verified Arc activities award only their first milestone, never client-supplied points", async () => {
  const login = await walletLogin();
  await approvedCollection(login.userId);
  for (const kind of ["DEPLOY_COLLECTION", "MINT_NFT", "BUY_ART", "PLACE_BID", "JOIN_REWARD", "CLAIM_REWARD"] as const) {
    const txHash = activityReceipt(kind);
    const response = await activityRoute.POST(request("/api/tester/activity", { kind, txHash, points: 999999, userId: "forged" }, login));
    assert.equal(response.status, 200, kind);
    const body = await response.json();
    assert.equal(body.recorded, true, kind);
    assert.equal(body.kind, kind);
    const again = await activityRoute.POST(request("/api/tester/activity", { kind, txHash }, login));
    assert.equal(again.status, 200);
    assert.equal((await again.json()).recorded, false);
    const another = await activityRoute.POST(request("/api/tester/activity", { kind, txHash: activityReceipt(kind) }, login));
    assert.equal(another.status, 200);
    assert.equal((await another.json()).recorded, false, "distinct transactions cannot farm a first-task milestone");
  }
  assert.equal((await mine(login)).points, 140);
  assert.equal(await db.testerMilestone.count({ where: { txHash: { not: null } } }), 6);
  const persisted = await db.testerMilestone.findMany({ where: { txHash: { not: null } } });
  assert.ok(persisted.every((milestone) => milestone.chainId === chainId && milestone.txHash === milestone.txHash?.toLowerCase()));
});

test("activity recording rejects foreign origins, unbound sessions, malformed or oversized bodies before RPC", async () => {
  const login = await walletLogin();
  const payload = { kind: "BUY_ART", txHash: hash() };
  const initialReads = reads;
  assert.equal((await activityRoute.POST(request("/api/tester/activity", payload, login, "https://attacker.example"))).status, 403);
  const noOrigin = request("/api/tester/activity", payload, login);
  noOrigin.headers.delete("origin");
  assert.equal((await activityRoute.POST(noOrigin)).status, 403);
  assert.equal((await activityRoute.POST(request("/api/tester/activity", payload))).status, 401);
  const forged = request("/api/tester/activity", payload, login);
  forged.headers.set("x-wallet-address", other);
  assert.equal((await activityRoute.POST(forged)).status, 401);
  for (const body of [{ kind: "SIGN_IN", txHash: hash() }, { kind: "APPROVED_CREATOR", txHash: hash() }, { kind: "UNKNOWN", txHash: hash() }, { kind: "BUY_ART", txHash: "invalid" }, { kind: "BUY_ART", txHash: hash(), extra: "x".repeat(5000) }, [], null]) {
    assert.equal((await activityRoute.POST(request("/api/tester/activity", body, login))).status, 400);
  }
  const broken = request("/api/tester/activity", payload, login);
  const malformed = new NextRequest(broken.url, { method: "POST", headers: broken.headers, body: "{" });
  assert.equal((await activityRoute.POST(malformed)).status, 400);
  assert.equal(reads, initialReads);
  assert.equal((await mine(login)).points, 10);
});

test("wrong networks, reverted receipts, foreign wallets, mismatched kinds and fake emitters cannot earn points", async () => {
  const login = await walletLogin();
  const validHash = activityReceipt("BUY_ART");
  rpcChainId = 1;
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash: validHash }, login))).status, 503);
  rpcChainId = chainId;
  const reverted = activityReceipt("BUY_ART", owner, { status: "reverted" });
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash: reverted }, login))).status, 400);
  const foreign = activityReceipt("BUY_ART", other);
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash: foreign }, login))).status, 403);
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { kind: "MINT_NFT", txHash: validHash }, login))).status, 400);
  const spoofed = activityReceipt("BUY_ART");
  (receipts.get(spoofed)!.logs as Array<{ address: Address }>)[0].address = other;
  const noEvent = await activityRoute.POST(request("/api/tester/activity", { txHash: spoofed }, login));
  assert.equal(noEvent.status, 200);
  assert.equal((await noEvent.json()).recorded, false);
  assert.equal((await mine(login)).points, 10);
  assert.equal(await db.testerMilestone.count({ where: { txHash: { not: null } } }), 0);
});

test("NFT mint points require both a published collection and its registration with the configured factory", async () => {
  const login = await walletLogin();
  const txHash = activityReceipt("MINT_NFT");
  const unpublished = await activityRoute.POST(request("/api/tester/activity", { txHash }, login));
  assert.equal(unpublished.status, 200);
  assert.equal((await unpublished.json()).recorded, false);
  await approvedCollection(login.userId);
  registeredCollections.clear();
  const unregistered = await activityRoute.POST(request("/api/tester/activity", { txHash }, login));
  assert.equal(unregistered.status, 200);
  assert.equal((await unregistered.json()).recorded, false);
  registeredCollections.set(collection.toLowerCase(), owner);
  const response = await activityRoute.POST(request("/api/tester/activity", { txHash }, login));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).recorded, true);
  assert.equal((await mine(login)).points, 40);
});

test("email accounts must prove transaction-wallet ownership with an account-bound signature", async () => {
  const login = await emailLogin();
  const txHash = activityReceipt("BUY_ART");
  const unsigned = await activityRoute.POST(request("/api/tester/activity", { txHash, walletAddress: owner }, login));
  assert.equal(unsigned.status, 403);
  assert.equal((await unsigned.json()).code, "WALLET_PROOF_REQUIRED");
  const message = proofMessage(login.userId, txHash);
  assert.equal(rules.testerActivityMessage(login.userId, txHash), message);
  const wrongSignature = await otherAccount.signMessage({ message });
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash, walletSignature: wrongSignature }, login))).status, 403);
  const wrongAccountSignature = await account.signMessage({ message: proofMessage("different-account", txHash) });
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash, walletSignature: wrongAccountSignature }, login))).status, 403);
  const wrongTransactionSignature = await account.signMessage({ message: proofMessage(login.userId, hash()) });
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash, walletSignature: wrongTransactionSignature }, login))).status, 403);
  const walletSignature = await account.signMessage({ message });
  const response = await activityRoute.POST(request("/api/tester/activity", { txHash, walletSignature }, login));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).recorded, true);
  assert.equal((await mine(login)).points, 50);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: login.userId } })).walletAddress, null, "a proof does not silently merge or modify account identities");
});

test("one chain transaction can be credited only once even across different signed accounts", async () => {
  const login = await walletLogin();
  const email = await emailLogin();
  const txHash = activityReceipt("BUY_ART");
  const first = await activityRoute.POST(request("/api/tester/activity", { txHash }, login));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).recorded, true);
  const walletSignature = await account.signMessage({ message: proofMessage(email.userId, txHash) });
  const replay = await activityRoute.POST(request("/api/tester/activity", { txHash, walletSignature }, email));
  assert.equal(replay.status, 409);
  assert.equal((await mine(email)).points, 10);
  assert.equal(await db.testerMilestone.count({ where: { chainId, txHash } }), 1);
  const sameAccount = await activityRoute.POST(request("/api/tester/activity", { txHash: `0x${txHash.slice(2).toUpperCase()}` }, login));
  assert.equal(sameAccount.status, 200);
  assert.equal((await sameAccount.json()).recorded, false, "case variants of a hash are the same transaction");
});

test("concurrent receipt claims create only one milestone and a single score increment", async () => {
  const login = await walletLogin();
  const txHash = activityReceipt("BUY_ART");
  const responses = await Promise.all([1, 2].map(() => activityRoute.POST(request("/api/tester/activity", { txHash }, login))));
  assert.ok(responses.every((response) => response.status === 200 || response.status === 409));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(bodies.filter((body) => body.recorded).length, 1);
  assert.equal((await mine(login)).points, 50);
  assert.equal(await db.testerMilestone.count({ where: { chainId, txHash } }), 1);
});

test("temporary RPC and database failures return honest unavailable responses without awarding points", async () => {
  const login = await walletLogin();
  const txHash = activityReceipt("BUY_ART");
  failRpc = true;
  assert.equal((await activityRoute.POST(request("/api/tester/activity", { txHash }, login))).status, 503);
  failRpc = false;
  assert.equal((await mine(login)).points, 10);
  assert.equal(await db.testerMilestone.count({ where: { txHash: { not: null } } }), 0);
  const transaction = db.$transaction;
  Object.assign(db, { $transaction: async () => { throw new Error("Temporary database unavailable"); } });
  try {
    assert.equal((await publicRoute.GET(request("/api/leaderboard"))).status, 503);
    assert.equal((await meRoute.GET(request("/api/leaderboard/me", undefined, login))).status, 503);
  } finally { Object.assign(db, { $transaction: transaction }); }
  assert.equal((await mine(login)).points, 10);
});

test("pagination bounds are enforced and empty pages never manufacture users", async () => {
  const empty = await (await publicRoute.GET(request("/api/leaderboard"))).json();
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.stats.totalUsers, 0);
  assert.equal(empty.stats.totalPoints, 0);
  for (const query of ["page=-1", "page=1.5", "page=NaN", "pageSize=-2", "pageSize=1000"]) assert.equal((await publicRoute.GET(request(`/api/leaderboard?${query}`))).status, 400);
  await emailLogin();
  const bounded = await (await publicRoute.GET(request("/api/leaderboard?page=1&pageSize=999"))).json();
  assert.equal(bounded.pagination.pageSize, 50);
  assert.equal(bounded.entries.length, 1);
  const beyond = await (await publicRoute.GET(request("/api/leaderboard?page=9999999"))).json();
  assert.equal(beyond.pagination.page, 1_000_000);
  assert.equal(beyond.entries.length, 0);
  assert.equal(beyond.stats.totalUsers, 1);
});

test("verified-account backfill excludes marketplace demos and preserves more recent activity when repeated", async () => {
  await db.user.create({ data: { walletAddress: "0x7777777777777777777777777777777777777777", username: "Demo artist" } });
  const email = await emailLogin("backfill@example.com", false);
  const wallet = await walletLogin(owner, false);
  const imported = await board.backfillVerifiedTesters();
  assert.equal(imported.imported, 2);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 2);
  const active = new Date(Date.now() + 60_000);
  await db.testerProfile.update({ where: { userId: email.userId }, data: { lastActiveAt: active } });
  const second = await board.backfillVerifiedTesters();
  assert.equal(second.imported, 0);
  assert.equal((await db.testerProfile.findUniqueOrThrow({ where: { userId: email.userId } })).lastActiveAt.toISOString(), active.toISOString());
  assert.deepEqual(await milestoneKinds(wallet.userId), ["SIGN_IN"]);
  assert.deepEqual(await milestoneKinds(email.userId), ["SIGN_IN"]);
});

test("backfill recovers legacy signed wallets without User rows and ignores malformed or unproven wallets", async () => {
  const first = new Date("2026-01-05T12:00:00Z");
  const latest = new Date("2026-02-10T12:00:00Z");
  await db.user.create({ data: { walletAddress: other, username: "Seeded wallet without a sign-in" } });
  await db.walletSession.createMany({ data: [
    { walletAddress: account.address, tokenHash: randomBytes(32).toString("hex"), createdAt: first, expiresAt: new Date(first.getTime() + 86_400_000) },
    { walletAddress: owner, tokenHash: randomBytes(32).toString("hex"), createdAt: latest, expiresAt: new Date(latest.getTime() + 86_400_000) },
    { walletAddress: "not-a-valid-wallet", tokenHash: randomBytes(32).toString("hex"), createdAt: first, expiresAt: latest },
  ] });
  assert.equal(await db.user.findUnique({ where: { walletAddress: owner } }), null);
  assert.deepEqual(await board.backfillVerifiedTesters(), { imported: 1 });
  const user = await db.user.findUniqueOrThrow({ where: { walletAddress: owner } });
  const profile = await db.testerProfile.findUniqueOrThrow({ where: { userId: user.id } });
  assert.equal(profile.joinedAt.toISOString(), first.toISOString(), "the earliest normalized session proves joining time");
  assert.equal(profile.lastActiveAt.toISOString(), latest.toISOString(), "the most recent persisted sign-in proves activity time");
  assert.deepEqual(await milestoneKinds(user.id), ["SIGN_IN"]);
  assert.equal((await board.getTesterLeaderboard({})).stats.totalUsers, 1);
  assert.equal((await board.getTesterEntry(user.id))?.points, 10);
  assert.equal(await db.user.count(), 2, "only the proven wallet receives a new User row");
  assert.deepEqual(await board.backfillVerifiedTesters(), { imported: 0 });
  assert.equal(await db.testerProfile.count(), 1);
});
