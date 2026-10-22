import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { usdcAmount } from "../../lib/protocol";

const require = createRequire(import.meta.url);
const current = `0x${"1".repeat(40)}`;
const previous = `0x${"2".repeat(40)}`;
const wallet = `0x${"3".repeat(40)}`;
const nft = `0x${"4".repeat(40)}`;
let renderer: ReactTestRenderer | undefined;
let feeAddress: string | null;
let queryAddress: string | null;
let feeError = false;
const writes: Array<Record<string, unknown>> = [];
const auction = { id: BigInt(1), seller: current, nft, tokenId: BigInt(7), reserve: usdcAmount("10"), bidder: wallet, bid: usdcAmount("20"), ends: Math.floor(Date.now() / 1000) + 3600, settled: false, claimed: false };
const tx = {
  address: wallet, isConnected: true, isWrongNetwork: false, pending: false, hash: null, error: "", client: {},
  refetchBalance: async () => {}, setError: () => {},
  run: async (action: (write: (args: Record<string, unknown>) => Promise<string>) => Promise<string>, after?: () => Promise<void>) => {
    try { await action(async (args) => { writes.push(args); return "0xabc"; }); await after?.(); } catch (error) { tx.error = (error as Error).message; }
  },
};
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/ReviewerOnly": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: noop, __esModule: true },
  "@/components/PlatformFeeBreakdown": require("../../components/PlatformFeeBreakdown"),
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/usePlatformFees": { usePlatformFees: (_client: unknown, address: string | null) => { feeAddress = address; return { data: feeError ? undefined : { legacy: address === previous, bps: address === previous ? BigInt(0) : BigInt(250), recipient: address === previous ? null : current }, isError: feeError, refetch: async () => {} }; } },
  "@/lib/arcConfig": require("../../lib/arcConfig"),
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { auctions: current, legacyAuctions: [previous], isTestnet: true } },
  "@tanstack/react-query": { useQuery: ({ queryKey }: { queryKey: string[] }) => { queryAddress = queryKey[1]; return { isLoading: false, isError: false, refetch: async () => {}, data: { auctions: [auction], rounds: [], eligible: true, balance: usdcAmount("5"), auctionCount: 1, roundCount: 0 } }; } },
};
const source = readFileSync(new URL("../../app/auctions/page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
const AuctionsPage = output.exports.default;
const buttonWithText = (text: string) => renderer!.root.findAllByType("button").find((node) => node.children.join("").includes(text))!;

beforeEach(() => { writes.length = 0; feeError = false; tx.error = ""; Object.assign(auction, { ends: Math.floor(Date.now() / 1000) + 3600, settled: false }); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

test("auction house selection keeps previous bids, refunds and NFT claims on their original contract", async () => {
  await act(async () => { renderer = create(React.createElement(AuctionsPage)); });
  assert.equal(feeAddress!, current);
  await act(async () => renderer!.root.findByProps({ id: "auction-house" }).props.onChange({ target: { value: previous } }));
  assert.equal(feeAddress!, previous); assert.equal(queryAddress!, previous);
  assert.match(JSON.stringify(renderer!.toJSON()), /Legacy deployment/);
  await act(async () => renderer!.root.findByProps({ id: "bid-1" }).props.onChange({ target: { value: "21" } }));
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "bid"); assert.equal(writes.at(-1)?.address, previous); assert.equal(writes.at(-1)?.value, usdcAmount("21"));
  await act(async () => buttonWithText("Withdraw USDC").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "withdraw"); assert.equal(writes.at(-1)?.address, previous);
  auction.ends = 1; auction.settled = true;
  await act(async () => renderer!.update(React.createElement(AuctionsPage)));
  await act(async () => buttonWithText("Claim NFT to your wallet").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "claimNFT"); assert.equal(writes.at(-1)?.address, previous);
});

test("bids disclose the submitted total, platform fee and proceeds before creator royalties", async () => {
  await act(async () => { renderer = create(React.createElement(AuctionsPage)); });
  await act(async () => renderer!.root.findByProps({ id: "bid-1" }).props.onChange({ target: { value: "24" } }));
  const spans = renderer!.root.findByProps({ "aria-label": "Payment breakdown" }).findAllByType("span").map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" ");
  for (const text of ["Your bid payment", "24 USDC", "0.6 USDC", "Seller proceeds before royalties", "23.4 USDC"]) assert.ok(spans.includes(text), text);
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.at(-1)?.value, usdcAmount("24"));
});

test("fee read failures block new bids while allowing recovery of existing proceeds", async () => {
  feeError = true;
  await act(async () => { renderer = create(React.createElement(AuctionsPage)); });
  assert.equal(buttonWithText("Place bid").props.disabled, true);
  await act(async () => buttonWithText("Place bid").props.onClick());
  assert.equal(writes.length, 0); assert.match(tx.error, /platform fee check/);
  await act(async () => buttonWithText("Withdraw USDC").props.onClick());
  assert.equal(writes.at(-1)?.functionName, "withdraw");
});
