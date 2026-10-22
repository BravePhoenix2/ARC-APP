import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { artMarketAbi, protocol, usdcAmount } from "../../lib/protocol";
import { type PlatformFeeTerms } from "../../lib/platformFeeRead";
import { emptyArtDelivery } from "../../lib/artDelivery";

const require = createRequire(import.meta.url);
const wallet = `0x${"1".repeat(40)}`;
const market = `0x${"2".repeat(40)}` as `0x${string}`;
const hash = `0x${"a".repeat(64)}`;
const originalFetch = globalThis.fetch;
let renderer: ReactTestRenderer | undefined;
let logins: number;
let connections: number;
let payments: number;
let saved: { txHash: string; delivery: typeof emptyArtDelivery } | undefined;
let lastWrite: Record<string, unknown> | undefined;
let saveFailure = false;
const account = { ready: true, authenticated: false, identity: "guest", walletAddress: undefined as string | undefined, headers: {}, login: () => { logins++; }, connectWallet: () => { connections++; } };
const tx = { isConnected: false, pending: false, isWrongNetwork: false, address: wallet, client: null, error: "", hash: null, refetchBalance: async () => {}, switchToArc: async () => {}, setError: (error: string) => { tx.error = error; }, run: async (action: (write: (args: Record<string, unknown>) => Promise<string>) => Promise<string>, after: (hash: string) => Promise<void>) => {
  payments++;
  try { const result = await action(async (args) => { lastWrite = args; return hash; }); await after(result); }
  catch (error) { tx.error = (error as Error).message; }
} };
const item = { artMarketAddress: undefined as string | undefined, id: "approved", itemType: "NFT", title: "Approved item", creationMethod: "HUMAN", nftKind: "COLLECTIBLE", contractAddress: wallet as string | null, mintPriceUsdc: 25, priceUsdc: 25, sold: false, artListingId: "42" as string | null, artListingSeller: market, creator: { username: "Creator" } };
const state = { phase: 3, phaseCount: BigInt(0), phasePrice: BigInt(25), phaseLimit: BigInt(2), price: BigInt(25), start: BigInt(0), timestamp: BigInt(1), count: BigInt(0), supply: BigInt(10), max: BigInt(2), minted: BigInt(0), owner: market, proceeds: BigInt(0) };
let mintAccess: any = { plan: null };
let feeTerms: PlatformFeeTerms | undefined = { legacy: false, bps: BigInt(250), recipient: market };
let feeError = false;
let feeContract: string | null = null;
let isOwner = false;
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: noop, __esModule: true },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/ReviewerOnly": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: noop, __esModule: true },
  "@/components/PlatformFeeBreakdown": require("../../components/PlatformFeeBreakdown"),
  "@/hooks/usePlatformFees": { usePlatformFees: (_client: unknown, address: string | null) => { feeContract = address; return { data: feeTerms, isError: feeError, refetch: async () => {} }; } },
  "@/components/WatchlistButton": { default: noop, __esModule: true },
  "@/components/ShareItemButton": { default: noop, __esModule: true },
  "@/components/CreatorLink": { default: noop, __esModule: true },
  "@/components/MintAccessPanel": { default: noop, __esModule: true },
  "@/hooks/useMintAccess": { useMintAccess: () => ({ data: mintAccess }) },
  "@/lib/mintAccess": require("../../lib/mintAccess"),
  "@/components/CollectionImageGallery": { default: noop, __esModule: true },
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { ...protocol, factory: market, artMarket: market, isTestnet: true }, artMarketForItem: (item: { artMarketAddress?: string | null }) => item.artMarketAddress ? require("../../lib/protocol").artMarketForItem(item) : market, artMarketAbi },
  "@/lib/nftTypes": require("../../lib/nftTypes"),
  "@/lib/artDelivery": require("../../lib/artDelivery"),
  "@tanstack/react-query": { useQuery: ({ queryKey }: { queryKey: string[] }) => ({ isLoading: false, isError: false, refetch: async () => {}, data: queryKey[0] === "item-detail" ? { item, isOwner } : queryKey[0] === "collection-state" ? state : queryKey[0] === "art-order" ? { order: null } : { listing: [market, "art-hash", BigInt(25), `0x${"0".repeat(40)}`, false], proceeds: BigInt(0) } }) },
};
function load(file: string): React.ComponentType<{ id: string }> {
  const source = readFileSync(new URL(`../../components/${file}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as { default: React.ComponentType<{ id: string }> } };
  new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
  return output.exports.default;
}
const CollectionDetail = load("CollectionDetail");
const ArtCheckout = load("ArtCheckout");
beforeEach(() => {
  logins = connections = payments = 0; saved = undefined; lastWrite = undefined; saveFailure = false;
  Object.assign(account, { authenticated: false, identity: "guest", walletAddress: undefined });
  Object.assign(tx, { isConnected: false, error: "" });
  feeTerms = { legacy: false, bps: BigInt(250), recipient: market }; feeError = false; isOwner = false; item.artMarketAddress = undefined; item.contractAddress = wallet; item.artListingId = "42";
  Object.assign(state, { price: BigInt(25) });
  item.itemType = "NFT"; mintAccess = { plan: null }; Object.assign(state, { phase: 3, phaseCount: BigInt(0), phasePrice: BigInt(25), phaseLimit: BigInt(2) });
  globalThis.fetch = async (_url, options) => { saved = JSON.parse(options?.body as string); return saveFailure ? Response.json({ error: "Retry saving; do not pay again." }, { status: 503 }) : Response.json({ order: { id: "order" } }); };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; globalThis.fetch = originalFetch; });

test("NFT mint action opens sign-in and wallet connection instead of being disabled", async () => {
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const button = renderer!.root.findAllByType("button").find((node) => node.props.children === "Sign in to mint")!;
  assert.ok(button); assert.equal(button.props.disabled, false);
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(logins, 1); assert.equal(payments, 0);
  account.authenticated = true;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(connections, 1); assert.equal(payments, 0);
});

test("art checkout opens sign-in and saves delivery only after the confirmed payment callback", async () => {
  item.itemType = "WEB2_ART";
  await act(async () => { renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  const signIn = renderer!.root.findAllByType("button").find((node) => node.props.children === "Sign in to purchase")!;
  assert.ok(signIn); assert.equal(signIn.props.disabled, false);
  act(() => signIn.props.onClick()); assert.equal(logins, 1);
  Object.assign(account, { authenticated: true, identity: "buyer", walletAddress: wallet }); tx.isConnected = true;
  await act(async () => renderer!.update(React.createElement(ArtCheckout, { id: item.id })));
  const values = { recipient: "Buyer Name", phone: "+234 800 123 4567", addressLine1: "12 Example Street", city: "Lagos", country: "Nigeria" };
  await act(async () => { for (const [name, value] of Object.entries(values)) renderer!.root.findByProps({ name }).props.onChange({ target: { value } }); });
  const form = renderer!.root.findByType("form");
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(payments, 1); assert.equal(lastWrite?.functionName, "buyListing");
  assert.equal(saved?.txHash, hash); assert.equal(saved?.delivery.addressLine1, values.addressLine1);
});

test("failed order saving retries delivery without charging for a second purchase", async () => {
  item.itemType = "WEB2_ART";
  Object.assign(account, { authenticated: true, identity: "buyer", walletAddress: wallet }); tx.isConnected = true;
  await act(async () => { renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(payments, 0, "an invalid address cannot initiate payment");
  const values = { recipient: "Buyer Name", phone: "+234 800 123 4567", addressLine1: "12 Example Street", city: "Lagos", country: "Nigeria" };
  await act(async () => { for (const [name, value] of Object.entries(values)) renderer!.root.findByProps({ name }).props.onChange({ target: { value } }); });
  saveFailure = true;
  await act(async () => { renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(payments, 1);
  assert.ok(renderer!.root.findAllByType("button").some((node) => node.props.children === "Save delivery details — no new payment"));
  saveFailure = false;
  await act(async () => { await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
  assert.equal(payments, 1); assert.equal(saved?.txHash, hash);
});


test("allowlisted mint uses the assigned tier proof and phase price; pending wallets cannot mint early", async () => {
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  mintAccess = { plan: { root: hash, frozenAt: new Date().toISOString() }, entry: { tier: "ULTIMATE" }, proof: [] };
  Object.assign(state, { phase: 1, phasePrice: BigInt(5), phaseLimit: BigInt(1) });
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite?.functionName, "mintAllowlisted"); assert.deepEqual(lastWrite?.args, [BigInt(1), 1, []]); assert.equal(lastWrite?.value, BigInt(5));
  lastWrite = undefined; mintAccess.entry.tier = "PENDING";
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite, undefined); assert.match(tx.error, /does not have access/);
  state.phase = 3;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  const publicWrite = lastWrite as Record<string, unknown> | undefined;
  assert.equal(publicWrite?.functionName, "mint"); assert.equal(publicWrite?.value, state.price);
});


test("mint breakdown tracks quantity and current phase price without adding a buyer surcharge", async () => {
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  Object.assign(state, { phase: 1, phasePrice: usdcAmount("0.1"), phaseLimit: BigInt(2) });
  mintAccess = { plan: { root: hash, frozenAt: new Date().toISOString() }, entry: { tier: "ULTIMATE" }, proof: [] };
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => renderer!.root.findByProps({ id: "mint-quantity" }).props.onChange({ target: { value: "2" } }));
  const disclosure = renderer!.root.findByProps({ "aria-label": "Payment breakdown" });
  const text = disclosure.findAllByType("span").map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" ");
  assert.match(text, /Total mint payment/); assert.match(text, /0.2 USDC/); assert.match(text, /0.005 USDC/); assert.match(text, /0.195 USDC/);
  assert.equal(feeContract, item.contractAddress, "deployed collection terms must override the current factory terms");
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite?.value, usdcAmount("0.2"));
});

test("art fee terms follow the listing market address and unavailable fees block new payment", async () => {
  item.itemType = "WEB2_ART"; item.artMarketAddress = `0x${"3".repeat(40)}`;
  Object.assign(account, { authenticated: true, identity: "buyer", walletAddress: wallet }); tx.isConnected = true;
  feeTerms = undefined; feeError = true;
  await act(async () => { renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  assert.equal(feeContract, item.artMarketAddress);
  assert.match(JSON.stringify(renderer!.toJSON()), /Platform fee could not be verified/);
  const values = { recipient: "Buyer Name", phone: "+234 800 123 4567", addressLine1: "12 Example Street", city: "Lagos", country: "Nigeria" };
  await act(async () => { for (const [name, value] of Object.entries(values)) renderer!.root.findByProps({ name }).props.onChange({ target: { value } }); });
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite, undefined); assert.match(tx.error, /platform fee check/);
});

test("creators see the platform deduction before activating art checkout", async () => {
  item.itemType = "WEB2_ART"; isOwner = true; item.artListingId = null;
  await act(async () => { renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  assert.ok(renderer!.root.findAllByType("button").some((node) => node.props.children === "Activate artwork checkout"));
  assert.match(JSON.stringify(renderer!.toJSON()), /Creator receives/);
  assert.match(JSON.stringify(renderer!.toJSON()), /2.5%/);
});


test("collection creators review the factory mint fee before deployment", async () => {
  item.contractAddress = null; isOwner = true;
  feeTerms = { legacy: false, bps: BigInt(1000), recipient: market };
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  assert.equal(feeContract, market);
  const spans = renderer!.root.findByProps({ "aria-label": "Payment breakdown" }).findAllByType("span").map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" ");
  for (const text of ["Public mint payment per token", "25 USDC", "Platform fee (10%)", "2.5 USDC", "22.5 USDC"]) assert.ok(spans.includes(text), text);
});
