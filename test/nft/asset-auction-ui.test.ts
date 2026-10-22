import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { zeroAddress, type Address, type Hash } from "viem";
import { assetAuctionCommitment, type AssetAuctionDTO } from "../../lib/assetAuctions";
import { assertAssetBid, assetAuctionNow, pendingAssetAuctionKey, readPendingAssetAuctions, verifiedAssetAuction } from "../../lib/assetAuctionClient";
import { usdcAmount } from "../../lib/protocol";

const require = createRequire(import.meta.url);
const seller = `0x${"1".repeat(40)}` as Address;
const market = `0x${"2".repeat(40)}` as Address;
const wallet = `0x${"3".repeat(40)}` as Address;
const other = `0x${"4".repeat(40)}` as Address;
const hash = `0x${"5".repeat(64)}` as Hash;
const epoch = Math.floor(Date.now() / 1000);
let blockTime = epoch;
let renderer: ReactTestRenderer | undefined;
let feeError = false;
let verificationError = false;
let drafts: AssetAuctionDTO[] = [];
let listed: AssetAuctionDTO[] = [];
let settled = false;
let bidder: Address = wallet;
let activationFail = false;
const writes: Array<Record<string, unknown>> = [];
const calls: Array<{ url: string; init?: RequestInit }> = [];
const queryKeys: unknown[][] = [];
const storage = new Map<string, string>();
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function fixture(kind: "DIGITAL" | "PHYSICAL" = "DIGITAL"): AssetAuctionDTO {
  const listing: AssetAuctionDTO = { id: kind === "DIGITAL" ? "digital-1" : "physical-1", kind, title: kind === "DIGITAL" ? "Digital artwork" : "Physical sculpture", description: "An original asset for the timed auction room.", imageUrl: "/api/uploads/asset1", deliveryTerms: "Delivery arranged directly with the winning collector.", reservePrice: "10", endsAt: new Date((epoch + 3600) * 1000).toISOString(), assetKey: hash, marketAddress: market, chainId: 5042002, auctionId: kind === "DIGITAL" ? "1" : "2", activationTxHash: hash, sellerWallet: seller, createdAt: new Date(epoch * 1000).toISOString(), seller: { username: "Artist", avatarUrl: null } };
  listing.assetKey = assetAuctionCommitment({ ...listing, endsAt: new Date(listing.endsAt) }); return listing;
}
function tuple(listing = listed[0]) {
  return [seller, zeroAddress, BigInt(0), usdcAmount("10"), bidder, usdcAmount("20"), BigInt(Math.floor(new Date(listing.endsAt).getTime() / 1000)), settled, false] as const;
}
const account = { identity: "user-1", accountId: "user-1", authenticated: true, walletAddress: wallet as string | undefined, ready: true, headers: { "X-Artiq-Account-ID": "user-1", "X-Wallet-Address": wallet }, login: () => {}, connectWallet: () => {} };
const tx = {
  address: wallet, isConnected: true, isWrongNetwork: false, pending: false, hash: null, error: "", refetchBalance: async () => {}, switchToArc: async () => {}, setError: (message: string) => { tx.error = message; },
  client: { getBlock: async () => ({ timestamp: BigInt(blockTime) }), readContract: async ({ functionName, args }: { functionName: string; args?: bigint[] }) => {
    const listing = listed.find((entry) => entry.auctionId === String(args?.[0])) || listed[0];
    if (functionName === "auctions") return tuple(listing);
    if (functionName === "auctionAssets") return [listing.assetKey, listing.kind === "DIGITAL" ? 1 : 2];
    if (functionName === "assetAuctionIds") return BigInt(0);
    return true;
  } },
  run: async (action: (write: (args: Record<string, unknown>) => Promise<Hash>) => Promise<Hash>, after?: (hash: Hash) => Promise<void>) => {
    try { const result = await action(async (args) => { writes.push(args); return hash; }); await after?.(result); } catch (cause) { tx.error = (cause as Error).message; }
  },
};
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: ({ fill: _fill, unoptimized: _unoptimized, ...props }: Record<string, unknown>) => React.createElement("img", props), __esModule: true },
  "@/components/ReviewerOnly": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: noop, __esModule: true },
  "@/components/PlatformFeeBreakdown": require("../../components/PlatformFeeBreakdown"),
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/hooks/usePlatformFees": { usePlatformFees: () => ({ data: feeError ? undefined : { bps: BigInt(250), recipient: market, legacy: false }, isError: feeError, refetch: async () => {} }) },
  "@/lib/arcConfig": require("../../lib/arcConfig"),
  "@/lib/artDelivery": require("../../lib/artDelivery"),
  "@/lib/assetAuctionClient": require("../../lib/assetAuctionClient"),
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { auctions: market, legacyAuctions: [], isTestnet: true } },
  "@tanstack/react-query": { useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    queryKeys.push(queryKey);
    const base = { isLoading: false, isError: false, refetch: async () => {} };
    if (queryKey[0] === "asset-auctions") return { ...base, data: { auctions: listed, hasMore: false } };
    if (queryKey[0] === "asset-auctions-mine") return { ...base, data: { auctions: drafts, hasMore: false } };
    if (queryKey[0] === "asset-auctions-supported") return { ...base, data: true };
    if (queryKey[0] === "asset-auction-fulfillment") return { ...base, data: { kind: "DIGITAL", settled: true, winnerWallet: wallet, digitalDeliveryUrl: "https://example.test/private-download", delivery: null, needsDelivery: false } };
    return { ...base, isError: verificationError, data: { records: Object.fromEntries(listed.map((entry) => [entry.id, { auction: verifiedAssetAuction(entry, tuple(entry), [entry.assetKey, entry.kind === "DIGITAL" ? 1 : 2], [market]) }])), balances: [{ address: market, amount: usdcAmount("5") }], timestamp: blockTime, observedAt: performance.now() } };
  } },
};
const source = readFileSync(new URL("../../components/AssetAuctionMarket.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
const AssetAuctionMarket = output.exports.default;
const buttonWithText = (text: string) => renderer!.root.findAllByType("button").find((node) => node.children.filter((child) => typeof child === "string").join("").includes(text))!;
async function render() { await act(async () => { renderer = create(React.createElement(AssetAuctionMarket)); }); }

beforeEach(() => {
  writes.length = 0; calls.length = 0; queryKeys.length = 0; storage.clear(); drafts = []; listed = [fixture()];
  blockTime = epoch; feeError = false; verificationError = false; settled = false; bidder = wallet; activationFail = false; tx.error = ""; account.walletAddress = wallet;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) } });
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(activationFail ? { error: "Registration temporarily unavailable" } : { auction: listed[0] }), { status: activationFail ? 503 : 200, headers: { "Content-Type": "application/json" } }); };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("asset verification binds all public details and contract identity before bidding", () => {
  const listing = fixture();
  assert.equal(verifiedAssetAuction(listing, tuple(listing), [listing.assetKey, 1], [market]).bid, usdcAmount("20"));
  assert.throws(() => verifiedAssetAuction({ ...listing, title: "Different asset" }, tuple(listing), [listing.assetKey, 1], [market]), /does not match/);
  assert.throws(() => verifiedAssetAuction(listing, tuple(listing), [hash, 1], [market]), /does not match/);
  assert.throws(() => verifiedAssetAuction(listing, tuple(listing), [listing.assetKey, 2], [market]), /does not match/);
  assert.throws(() => verifiedAssetAuction({ ...listing, marketAddress: other }, tuple(listing), [listing.assetKey, 1], [market]), /does not match/);
});

test("chain clock advances every second and the exact deadline rejects bids", () => {
  assert.equal(assetAuctionNow({ timestamp: 1000, observedAt: 5000 }, 7500), 1002);
  assert.equal(assetAuctionNow(undefined, 7500), 0);
  const state = verifiedAssetAuction(listed[0], tuple(), [listed[0].assetKey, 1], [market]);
  assert.doesNotThrow(() => assertAssetBid(state, usdcAmount("21"), state.ends - 1, wallet));
  assert.throws(() => assertAssetBid(state, usdcAmount("21"), state.ends, wallet), /timer has ended/);
  assert.throws(() => assertAssetBid(state, usdcAmount("20.999999"), state.ends - 1, wallet), /minimum bid/);
  assert.throws(() => assertAssetBid(state, usdcAmount("21"), state.ends - 1, seller), /own auction/);
});

test("asset grid filters digital and physical assets without fake inventory", async () => {
  listed = [fixture(), fixture("PHYSICAL")]; await render();
  assert.equal(renderer!.root.findAllByType("article").length, 2);
  await act(async () => buttonWithText("Physical").props.onClick());
  assert.equal(renderer!.root.findAllByType("article").length, 1);
  assert.match(JSON.stringify(renderer!.toJSON()), /Physical sculpture/);
  await act(async () => renderer!.root.findByProps({ "aria-label": "Search asset auctions" }).props.onChange({ target: { value: "missing asset" } }));
  assert.equal(renderer!.root.findAllByType("article").length, 0);
});

test("bidding rechecks current chain state, enforces 5%, and discloses seller proceeds without NFT royalties", async () => {
  await render();
  const breakdown = renderer!.root.findByProps({ "aria-label": "Payment breakdown" });
  assert.equal(breakdown.findAllByType("span").some((node) => node.children.join("") === "Seller receives"), true);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /ERC-2981/);
  await act(async () => renderer!.root.findByProps({ id: "asset-bid-digital-1" }).props.onChange({ target: { value: "20" } }));
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.length, 0); assert.match(tx.error, /minimum bid/);
  await act(async () => renderer!.root.findByProps({ id: "asset-bid-digital-1" }).props.onChange({ target: { value: "21" } }));
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "bid"); assert.equal(writes.at(-1)?.value, usdcAmount("21")); assert.equal(writes.at(-1)?.address, market);
  blockTime = epoch + 3600;
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.length, 1); assert.match(tx.error, /timer has ended/);
});

test("fee or chain verification failures block bids but leave refunds available", async () => {
  feeError = true; await render();
  assert.equal(buttonWithText("Place bid").props.disabled, true);
  await act(async () => buttonWithText("Place bid").props.onClick()); assert.equal(writes.length, 0);
  await act(async () => buttonWithText("Withdraw USDC").props.onClick()); assert.equal(writes.at(-1)?.functionName, "withdraw");
  verificationError = true;
  await act(async () => renderer!.update(React.createElement(AssetAuctionMarket)));
  assert.equal(buttonWithText("Place bid"), undefined);
});

test("expired auctions stop bidding and offer explicit settlement", async () => {
  blockTime = epoch + 3600; await render();
  assert.equal(buttonWithText("Place bid"), undefined);
  await act(async () => buttonWithText("Settle auction").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "settle");
});

test("confirmed registration can be retried after refresh without a second wallet transaction", async () => {
  const draft = { ...fixture(), auctionId: null }; drafts = [draft]; account.walletAddress = seller;
  const key = pendingAssetAuctionKey(account.identity, seller);
  storage.set(key, JSON.stringify([{ id: draft.id, marketAddress: market, sellerWallet: seller, chainId: 5042002, txHash: hash }]));
  activationFail = true; await render();
  await act(async () => buttonWithText("Retry confirmed registration").props.onClick());
  assert.equal(writes.length, 0); assert.equal(calls.at(-1)?.url, `/api/asset-auctions/${draft.id}/activate`); assert.equal(JSON.parse(calls.at(-1)!.init!.body as string).txHash, hash);
  assert.match(storage.get(key)!, new RegExp(hash));
  activationFail = false;
  await act(async () => buttonWithText("Retry confirmed registration").props.onClick());
  assert.equal(writes.length, 0); assert.equal(storage.get(key), "[]");
});

test("private digital delivery is loaded only for the settled seller or winner", async () => {
  settled = true; bidder = other; await render();
  assert.equal(queryKeys.some((key) => key[0] === "asset-auction-fulfillment"), false);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /private-download/);
  bidder = wallet;
  await act(async () => renderer!.update(React.createElement(AssetAuctionMarket)));
  assert.equal(queryKeys.some((key) => key[0] === "asset-auction-fulfillment"), true);
  assert.match(JSON.stringify(renderer!.toJSON()), /https:\/\/example.test\/private-download/);
});

test("pending references reject another wallet or chain and strip private data", () => {
  const record = { id: "draft-1", marketAddress: market, sellerWallet: wallet, chainId: 5042002, txHash: hash, digitalDeliveryUrl: "https://private.test/file", delivery: { addressLine1: "Private address" } };
  assert.deepEqual(readPendingAssetAuctions(JSON.stringify([record]), wallet, 5042002), [{ id: record.id, marketAddress: market, sellerWallet: wallet, chainId: 5042002, txHash: hash }]);
  assert.deepEqual(readPendingAssetAuctions(JSON.stringify([record]), other, 5042002), []);
  assert.deepEqual(readPendingAssetAuctions(JSON.stringify([record]), wallet, 1), []);
  assert.deepEqual(readPendingAssetAuctions("broken json", wallet, 5042002), []);
});
