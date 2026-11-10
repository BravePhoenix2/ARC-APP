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
const storageKey = "artiq:studio-testnet-deployment:mint-management-v3";
const artHash = `0x${"c".repeat(64)}` as const;
const fees = { feeRecipient: market, mintFeeBps: 250, mintSurchargeBps: 200, marketplaceFeeBps: 250 };
const originalRecipient = process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT;
let renderer: ReactTestRenderer | undefined;
let stored: Map<string, string>;
let writes: Record<string, unknown>[];
let waited: string[];
let walletFailure: boolean;
let receiptFailure: boolean;
let auctionFailure: boolean;
let connects: number;
let supportsMintSurcharge: boolean;
let supportReadFailure: boolean;
let supportsAssets: boolean;
let surchargeOverride: bigint | undefined;
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const account = { authenticated: true, login: () => { connects++; }, connectWallet: () => { connects++; } };
const tx = { address: market, isConnected: true, isWrongNetwork: false, chainId: 5042002, switchToArc: async () => {}, refetchBalance: async () => {}, client: {
  getCode: async () => "0x6000",
  readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
    if (functionName === "supportsMintSurcharge") { if (supportReadFailure) throw new Error("function unavailable"); return supportsMintSurcharge; }
    if (functionName === "supportsAssetAuctions") return supportsAssets;
    if (functionName === "supportsMintManagement") return true;
    const bytecode = address === factory ? "0x01" : address === market ? "0x02" : "0x03";
    const args = writes.find((write) => write.bytecode === bytecode)?.args as unknown[] | undefined;
    if (functionName === "feeRecipient") return args ? (address === factory ? args[0] : args.at(-2)) : market;
    if (functionName === "mintSurchargeBps") return surchargeOverride ?? args?.[2] ?? BigInt(200);
    return args ? (address === factory ? args[1] : args.at(-1)) : BigInt(250);
  },
  waitForTransactionReceipt: async ({ hash }: { hash: string }) => { waited.push(hash); if (receiptFailure) { receiptFailure = false; throw new Error("Receipt request timed out. Resume to check confirmation."); } return { status: "success", contractAddress: hash === factoryHash ? factory : hash === artHash ? market : auction }; },
} };
const wallet = { deployContract: async (args: Record<string, unknown>) => { writes.push(args); if (walletFailure || (auctionFailure && args.bytecode === "0x03")) throw Object.assign(new Error("User rejected"), { code: 4001 }); return args.bytecode === "0x01" ? factoryHash : args.bytecode === "0x02" ? artHash : auctionHash; } };
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "wagmi": { useWalletClient: () => ({ data: wallet }) },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/PlatformRevenue": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: ({ error }: { error: string }) => error ? React.createElement("p", { role: "alert" }, error) : null, __esModule: true },
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { factory: `0x${"4".repeat(40)}`, artMarket: market, auctions: `0x${"5".repeat(40)}`, isTestnet: true } },
  "@/lib/monetization": require("../../lib/monetization"),
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
  process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = market;
  stored = new Map(); writes = []; waited = []; connects = 0; walletFailure = receiptFailure = auctionFailure = false;
  supportsMintSurcharge = supportsAssets = true;
  supportReadFailure = false;
  surchargeOverride = undefined;
  account.authenticated = true; tx.isConnected = true;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; if (originalRecipient === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT; else process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT = originalRecipient; if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("incomplete or zero-address drafts cannot become copyable configuration", () => {
  assert.equal(deploymentConfiguration({ artMarket: market }), null);
  assert.equal(deploymentConfiguration({ factory, artMarket: market }), null);
  assert.equal(deploymentConfiguration({ factory, artMarket: market, auctions: `0x${"0".repeat(40)}` }), null);
  assert.deepEqual(readDeploymentDraft({ factory: "invalid", artMarket: market, fees }), { artMarket: market, fees });
  assert.equal(deploymentConfiguration({ factory, artMarket: market, auctions: auction }), null);
  assert.equal(deploymentConfiguration({ factory, artMarket: market, auctions: auction, fees, pending: { key: "factory", hash: factoryHash } }), null);
});
test("upgrade deploys all three fee contracts with explicit treasury terms and exports confirmed addresses", async () => {
  await mount(); assert.equal(exportBlocks().length, 0);
  await deploy();
  assert.equal(writes.length, 3); assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x02", "0x03"]);
  assert.deepEqual(writes[0].args, [market, BigInt(250), BigInt(200)]);
  assert.deepEqual(writes[1].args, [market, BigInt(250)]);
  assert.deepEqual(writes[2].args, [factory, market, market, BigInt(250)]);
  assert.equal(exportBlocks().length, 1);
  const config = exportBlocks()[0].props.children;
  assert.equal(config, deploymentConfiguration({ factory, artMarket: market, auctions: auction, fees }, [`0x${"5".repeat(40)}`]));
  assert.match(String(config), /MINT_FEE_BPS=250\nMINT_SURCHARGE_BPS=200\nMARKETPLACE_FEE_BPS=250/);
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
  assert.equal(writes.length, 3); assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x02", "0x03"]);
  assert.deepEqual(waited, [factoryHash, factoryHash, artHash, auctionHash]);
  assert.equal(exportBlocks().length, 1);
});
test("deployment action opens wallet connection when disconnected", async () => {
  tx.isConnected = false; await mount(); await deploy();
  assert.equal(connects, 1); assert.equal(writes.length, 0); assert.equal(exportBlocks().length, 0);
});


test("a rejected auction deployment preserves the confirmed factory and retries only the auction", async () => {
  auctionFailure = true; await mount(); await deploy();
  assert.equal(writes.length, 3); assert.equal(exportBlocks().length, 0);
  assert.equal(JSON.parse(stored.get(storageKey)!).factory, factory);
  await act(async () => renderer!.unmount()); await mount();
  auctionFailure = false; await deploy();
  assert.deepEqual(writes.map((w) => w.bytecode), ["0x01", "0x02", "0x03", "0x03"]);
  assert.equal(exportBlocks().length, 1);
});


test("an already connected wallet can deploy while app session verification is unavailable", async () => {
  account.authenticated = false; await mount(); await deploy();
  assert.equal(connects, 0); assert.equal(writes.length, 3); assert.equal(exportBlocks().length, 1);
});


test("OpenSea-style preset uses separate mint surcharge and sale rates", async () => {
  await mount();
  const preset = renderer!.root.findAllByType("button").find((node) => node.props.children === "OpenSea-style: 10% creator fee + 2% buyer surcharge / 1% sales")!;
  await act(async () => preset.props.onClick());
  await deploy();
  assert.deepEqual(writes[0].args, [market, BigInt(1000), BigInt(200)]);
  assert.deepEqual(writes[1].args, [market, BigInt(100)]);
  assert.deepEqual(writes[2].args, [factory, market, market, BigInt(100)]);
  assert.match(exportBlocks()[0].props.children, /MINT_FEE_BPS=1000\nMINT_SURCHARGE_BPS=200\nMARKETPLACE_FEE_BPS=100/);
});

test("invalid fee wallet or excessive rate prevents all deployment transactions", async () => {
  await mount();
  const recipient = renderer!.root.findByProps({ "aria-label": "Platform fee wallet" });
  await act(async () => recipient.props.onChange({ target: { value: `0x${"0".repeat(40)}` } }));
  await deploy(); assert.equal(writes.length, 0); assert.match(text(), /nonzero/);
  await act(async () => recipient.props.onChange({ target: { value: market } }));
  await act(async () => renderer!.root.findByProps({ "aria-label": "Creator mint proceeds fee (%)" }).props.onChange({ target: { value: "10.01" } }));
  await deploy(); assert.equal(writes.length, 0); assert.match(text(), /exceed 10%/);
  await act(async () => renderer!.root.findByProps({ "aria-label": "Creator mint proceeds fee (%)" }).props.onChange({ target: { value: "2.5" } }));
  await act(async () => renderer!.root.findByProps({ "aria-label": "Buyer mint surcharge (%)" }).props.onChange({ target: { value: "10.01" } }));
  await deploy(); assert.equal(writes.length, 0); assert.match(text(), /exceed 10%/);
});

test("resumed deployment retains frozen fee terms and ignores drafts from older factory generations", async () => {
  stored.set("artiq:studio-testnet-deployment:phases-v1", JSON.stringify({ factory, artMarket: market, auctions: auction }));
  stored.set("artiq:studio-testnet-deployment:asset-auctions-v1", JSON.stringify({ factory, artMarket: market, auctions: auction, fees: { feeRecipient: market, mintFeeBps: 250, marketplaceFeeBps: 250 } }));
  await mount();
  assert.equal(exportBlocks().length, 0);
  receiptFailure = true;
  await deploy();
  const saved = JSON.parse(stored.get(storageKey)!);
  assert.deepEqual(saved.fees, fees);
  assert.equal(renderer!.root.findAllByType("fieldset")[0].props.disabled, true);
});

test("an auction house without asset support cannot become complete configuration", async () => {
  supportsAssets = false;
  await mount(); await deploy();
  assert.equal(exportBlocks().length, 0);
  assert.match(text(), /does not support digital and physical/);
  assert.equal(writes.length, 3);
  await deploy();
  assert.equal(writes.length, 3, "retry verifies the submitted house instead of deploying a duplicate");
});

test("a factory without buyer-paid mint surcharge support cannot become current configuration", async () => {
  supportsMintSurcharge = false;
  await mount(); await deploy();
  assert.equal(exportBlocks().length, 0);
  assert.match(text(), /does not support buyer-paid mint surcharges/);
  assert.equal(writes.length, 1);
  await deploy();
  assert.equal(writes.length, 1, "retry verifies the submitted factory instead of deploying a duplicate");
});

test("a saved legacy factory is rejected before any later contract is deployed", async () => {
  supportReadFailure = true;
  stored.set(storageKey, JSON.stringify({ factory, fees }));
  await mount(); await deploy();
  assert.equal(writes.length, 0);
  assert.equal(exportBlocks().length, 0);
  assert.match(text(), /does not support buyer-paid mint surcharges/);
});

test("a saved factory with a different buyer surcharge is rejected before deployment continues", async () => {
  surchargeOverride = BigInt(300);
  stored.set(storageKey, JSON.stringify({ factory, fees }));
  await mount(); await deploy();
  assert.equal(writes.length, 0);
  assert.equal(exportBlocks().length, 0);
  assert.match(text(), /buyer surcharge does not match/);
});
