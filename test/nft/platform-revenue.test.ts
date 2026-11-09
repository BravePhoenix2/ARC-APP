import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as reactQuery from "@tanstack/react-query";
import { formatUnits, parseAbi, type Address } from "viem";
import ts from "typescript";

const require = createRequire(import.meta.url);
const treasury = `0x${"1".repeat(40)}` as Address;
const otherWallet = `0x${"9".repeat(40)}` as Address;
const factory = `0x${"2".repeat(40)}` as Address;
const market = `0x${"3".repeat(40)}` as Address;
const auctions = `0x${"4".repeat(40)}` as Address;
const hash = `0x${"a".repeat(64)}`;
const feeAbi = parseAbi([
  "function pendingPlatformFees() view returns (uint256)",
  "function totalPlatformFees() view returns (uint256)",
  "function withdrawPlatformFees(address receiver)",
]);
type Snapshot = { recipient: Address; bps: bigint; total: bigint; pending: bigint; legacy: boolean; unavailable: boolean };
const snapshots = new Map<Address, Snapshot>();
const protocol = { factory: factory as Address | null, artMarket: market, auctions, legacyAuctions: [] as Address[], isTestnet: true };
let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;
let writes: Record<string, unknown>[];
let reads: Record<string, unknown>[];
let runs: number;
let balanceRefreshes: number;
const tx = {
  address: treasury, isConnected: true, chainId: 5042002, isWrongNetwork: false, pending: false, error: "", hash: null,
  client: {
    getBlockNumber: async () => BigInt(500),
    readContract: async (args: Record<string, unknown>) => {
      reads.push(args);
      const state = snapshots.get(args.address as Address)!;
      if (state.unavailable) throw new Error("Arc RPC timed out.");
      if (args.functionName === "supportsMintSurcharge") return true;
      if (args.functionName === "mintSurchargeBps") return BigInt(200);
      if (args.functionName === "pendingPlatformFees") return state.pending;
      if (args.functionName === "totalPlatformFees") return state.total;
      throw new Error(`Unexpected read: ${args.functionName}`);
    },
  },
  refetchBalance: async () => { balanceRefreshes++; },
  switchToArc: async () => {},
  run: async (action: (write: (args: Record<string, unknown>) => Promise<string>) => Promise<string>, after?: (hash: string) => Promise<void>) => {
    runs++;
    try {
      const result = await action(async (args) => { writes.push(args); snapshots.get(args.address as Address)!.pending = BigInt(0); return hash; });
      await after?.(result);
    } catch (error) { tx.error = (error as Error).message; }
  },
};
const deps: Record<string, unknown> = {
  // Keep component hooks and this test's provider on the same ESM context.
  "@tanstack/react-query": reactQuery,
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/components/TransactionStatus": { default: () => null, __esModule: true },
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
  "@/lib/protocol": { protocol, platformFeeAbi: feeAbi },
  "@/lib/platformFeeRead": { readPlatformFeeTerms: async (_client: unknown, address: Address) => {
    const snapshot = snapshots.get(address)!;
    if (snapshot.unavailable) throw new Error("Arc RPC timed out.");
    return { legacy: snapshot.legacy, recipient: snapshot.legacy ? null : snapshot.recipient, bps: snapshot.bps };
  } },
};
const source = readFileSync(new URL("../../components/PlatformRevenue.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
const PlatformRevenue = output.exports.default;
const pageText = () => JSON.stringify(renderer!.toJSON());
const withdrawalButtons = () => renderer!.root.findAllByType("button").filter((node) => node.props.children === "Withdraw platform fees");
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
async function mount() {
  await act(async () => { renderer = create(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PlatformRevenue))); });
  await settle();
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  writes = []; reads = []; runs = 0; balanceRefreshes = 0; snapshots.clear();
  for (const address of [factory, market, auctions]) snapshots.set(address, { recipient: treasury, bps: BigInt(250), total: BigInt("9007199254740993123456789012345678"), pending: BigInt("2000000000000000000"), legacy: false, unavailable: false });
  Object.assign(tx, { address: treasury, isConnected: true, chainId: 5042002, isWrongNetwork: false, pending: false, error: "" });
  protocol.factory = factory; protocol.isTestnet = true; protocol.legacyAuctions = [];
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; queryClient.clear(); });

test("shows actual accrued and withdrawable fees without losing bigint precision", async () => {
  await mount();
  const text = pageText();
  assert.match(text, /Total fees accrued/);
  assert.match(text, new RegExp(formatUnits(snapshots.get(factory)!.total, 18).replace(".", "\\.")));
  assert.match(text, /Available to withdraw/);
  assert.match(text, /Test USDC has no monetary value/);
  assert.match(text, /5 test USDC collection creation fee directly to the platform wallet/);
  assert.match(text, /separate from the contract balances below/);
  assert.match(text, /2\.5/);
  assert.equal(withdrawalButtons().length, 3);
  assert.match(text, /Collector mint surcharge/);
  assert.match(text, /4\.5/);
  assert.equal(reads.filter((read) => read.functionName === "pendingPlatformFees" || read.functionName === "totalPlatformFees").length, 6);
  assert.ok(reads.every((read) => read.blockNumber === BigInt(500)));
});

test("fee recipient withdraws only platform fees to the connected wallet and refreshes accounting", async () => {
  await mount();
  assert.equal(withdrawalButtons()[0].props.disabled, false);
  await act(async () => withdrawalButtons()[0].props.onClick());
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].address, factory);
  assert.equal(writes[0].functionName, "withdrawPlatformFees");
  assert.deepEqual(writes[0].args, [treasury]);
  assert.equal(writes[0].account, treasury);
  assert.equal(writes[0].chainId, 5042002);
  assert.equal(balanceRefreshes, 1);
  assert.equal(withdrawalButtons()[0].props.disabled, true);
});

test("retained auction houses keep treasury fee withdrawals available after an upgrade", async () => {
  const previous = `0x${"5".repeat(40)}` as Address;
  snapshots.set(previous, { recipient: treasury, bps: BigInt(250), total: BigInt("3000000000000000000"), pending: BigInt("1000000000000000000"), legacy: false, unavailable: false });
  protocol.legacyAuctions = [previous, auctions, previous];
  await mount();
  assert.match(pageText(), /Previous auction house fees/);
  assert.equal(withdrawalButtons().length, 4);
  await act(async () => withdrawalButtons()[3].props.onClick());
  await settle();
  assert.equal(writes[0].address, previous);
  assert.equal(writes[0].functionName, "withdrawPlatformFees");
});

test("another wallet never receives an enabled platform withdrawal action", async () => {
  tx.address = otherWallet;
  await mount();
  assert.equal(withdrawalButtons().length, 0);
  assert.match(pageText(), /Connect this fee recipient wallet/);
  assert.equal(runs, 0);
});

test("a recipient changed after the displayed read cannot submit a withdrawal", async () => {
  await mount();
  snapshots.get(factory)!.recipient = otherWallet;
  await act(async () => withdrawalButtons()[0].props.onClick());
  assert.equal(writes.length, 0);
  assert.match(tx.error, /current fee recipient wallet/);
});

test("wrong-network recipients cannot submit withdrawals", async () => {
  tx.chainId = 1; tx.isWrongNetwork = true;
  await mount();
  assert.ok(withdrawalButtons().every((button) => button.props.disabled));
  await act(async () => withdrawalButtons()[0].props.onClick());
  assert.equal(runs, 0); assert.equal(writes.length, 0);
  assert.match(pageText(), /Switch to Arc Testnet/);
});

test("legacy deployments and RPC failures have distinct states with no invented accounting", async () => {
  snapshots.get(factory)!.legacy = true;
  snapshots.get(market)!.unavailable = true;
  await mount();
  const cards = renderer!.root.findAllByType("article");
  assert.match(JSON.stringify(cards[0].findAllByType("p").map((node) => node.props.children)), /legacy deployment/);
  assert.match(pageText(), /Fee accounting could not be read from Arc/);
  assert.match(pageText(), /Retry fee accounting/);
  assert.equal(withdrawalButtons().length, 1);
  assert.equal(reads.some((read) => read.address === factory || read.address === market), false);
});

test("unconfigured contracts show setup information without making a contract read", async () => {
  protocol.factory = null;
  await mount();
  assert.match(pageText(), /Contract not configured/);
  assert.equal(reads.some((read) => read.address === factory), false);
  assert.equal(withdrawalButtons().length, 2);
});
