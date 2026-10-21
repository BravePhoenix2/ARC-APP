import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { deploymentConfiguration, readDeploymentDraft } from "../../lib/studioDeployment";
const require = createRequire(import.meta.url);
const market = `0x${"1".repeat(40)}` as const;
const factory = `0x${"2".repeat(40)}` as const;
const auction = `0x${"3".repeat(40)}` as const;
const factoryHash = `0x${"a".repeat(64)}` as const;
const auctionHash = `0x${"b".repeat(64)}` as const;
const storageKey = "artiq:studio-testnet-deployment:phases-v1";
let renderer: ReactTestRenderer | undefined;
let stored: Map<string, string>;
let writes: Record<string, unknown>[];
let waited: string[];
let walletFailure: boolean;
let receiptFailure: boolean;
let auctionFailure: boolean;
let connects: number;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const account = { authenticated: true, login: () => { connects++; }, connectWallet: () => { connects++; } };
const tx = { address: market, isConnected: true, isWrongNetwork: false, chainId: 5042002, switchToArc: async () => {}, refetchBalance: async () => {}, client: {
  getCode: async () => "0x6000",
  waitForTransactionReceipt: async ({ hash }: { hash: string }) => { waited.push(hash); if (receiptFailure) { receiptFailure = false; throw new Error("Receipt request timed out. Resume to check confirmation."); } return { status: "success", contractAddress: hash === factoryHash ? factory : auction }; },
} };
const wallet = { deployContract: async (args: Record<string, unknown>) => { writes.push(args); if (walletFailure || (auctionFailure && args.bytecode === "0x03")) throw Object.assign(new Error("User rejected"), { code: 4001 }); return args.bytecode === "0x01" ? factoryHash : auctionHash; } };
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "wagmi": { useWalletClient: () => ({ data: wallet }) },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: ({ error }: { error: string }) => error ? React.createElement("p", { role: "alert" }, error) : null, __esModule: true },
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { factory: `0x${"4".repeat(40)}`, artMarket: market, auctions: `0x${"5".repeat(40)}`, isTestnet: true } },
  "@/lib/studioDeployment": require("../../lib/studioDeployment"),
  "@/lib/contracts/studio-deployments.json": { ArticStudioFactory: { abi: [], bytecode: "0x01" }, ArticArtMarket: { abi: [], bytecode: "0x02" }, ArticAuctionHouse: { abi: [], bytecode: "0x03" } },
};
const source = readFileSync(new URL("../../app/settings/protocol/page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
const Page = output.exports.default;
const text = () => JSON.stringify(renderer!.toJSON());
const exportBlocks = () => renderer!.root.findAllByType("pre");
async function mount() { await act(async () => { renderer = create(React.createElement(Page)); }); }
async function deploy() { const button = renderer!.root.findAllByType("button").find((node) => node.props.children?.some?.((child: unknown) => typeof child === "string" && /deploy|Switch to Arc/i.test(child)))!; assert.ok(button); await act(async () => { button.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); }); }
beforeEach(() => {
  stored = new Map(); writes = []; waited = []; connects = 0; walletFailure = receiptFailure = auctionFailure = false;
  account.authenticated = true; tx.isConnected = true;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("incomplete or zero-address drafts cannot become copyable configuration", () => {
  assert.equal(deploymentConfiguration({ artMarket: market }), null);
  assert.equal(deploymentConfiguration({ factory, artMarket: market }), null);
  assert.equal(deploymentConfiguration({ factory, artMarket: market, auctions: `0x${"0".repeat(40)}` }), null);
  assert.deepEqual(readDeploymentDraft({ factory: "invalid", artMarket: market }), { artMarket: market });
});
test("one upgrade action deploys factory and auction house, reuses the art market, and exports only confirmed addresses", async () => {
  await mount(); assert.equal(exportBlocks().length, 0);
  await deploy();
  assert.equal(writes.length, 2); assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x03"]);
  assert.deepEqual(writes[1].args, [factory, market]);
  assert.equal(exportBlocks().length, 1);
  const config = exportBlocks()[0].props.children;
  assert.equal(config, `NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${factory}\nNEXT_PUBLIC_ART_MARKET_ADDRESS=${market}\nNEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${auction}`);
  assert.equal(JSON.parse(stored.get(storageKey)!).pending, undefined);
});
test("cancelled wallet deployment reports the error and never displays blank configuration", async () => {
  walletFailure = true; await mount(); await deploy();
  assert.equal(writes.length, 1); assert.equal(exportBlocks().length, 0);
  assert.match(text(), /Transaction cancelled/); assert.doesNotMatch(text(), /NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=/);
});
test("refreshing after a receipt timeout resumes the saved hash without deploying a second factory", async () => {
  receiptFailure = true; await mount(); await deploy();
  assert.equal(writes.length, 1); assert.equal(exportBlocks().length, 0);
  assert.deepEqual(JSON.parse(stored.get(storageKey)!).pending, { key: "factory", hash: factoryHash });
  await act(async () => renderer!.unmount()); await mount(); await deploy();
  assert.equal(writes.length, 2); assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x03"]);
  assert.deepEqual(waited, [factoryHash, factoryHash, auctionHash]);
  assert.equal(exportBlocks().length, 1);
});
test("deployment action opens wallet connection when disconnected", async () => {
  tx.isConnected = false; await mount(); await deploy();
  assert.equal(connects, 1); assert.equal(writes.length, 0); assert.equal(exportBlocks().length, 0);
});


test("a rejected auction deployment preserves the confirmed factory and retries only the auction", async () => {
  auctionFailure = true; await mount(); await deploy();
  assert.equal(writes.length, 2); assert.equal(exportBlocks().length, 0);
  assert.equal(JSON.parse(stored.get(storageKey)!).factory, factory);
  await act(async () => renderer!.unmount()); await mount();
  auctionFailure = false; await deploy();
  assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x03", "0x03"]);
  assert.equal(exportBlocks().length, 1);
});


test("an already connected wallet can deploy while app session verification is unavailable", async () => {
  account.authenticated = false; await mount(); await deploy();
  assert.equal(connects, 0); assert.equal(writes.length, 2); assert.equal(exportBlocks().length, 1);
});
