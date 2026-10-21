import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { artMarketAbi, protocol } from "../../lib/protocol";
import { emptyArtDelivery } from "../../lib/artDelivery";

const require = createRequire(import.meta.url);
const wallet = `0x${"1".repeat(40)}`;
const market = `0x${"2".repeat(40)}`;
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
const item = { id: "approved", itemType: "NFT", title: "Approved item", creationMethod: "HUMAN", nftKind: "COLLECTIBLE", contractAddress: wallet, mintPriceUsdc: 25, priceUsdc: 25, sold: false, artListingId: "42", artListingSeller: market, creator: { username: "Creator" } };
const state = { phase: 3, phaseCount: BigInt(0), phasePrice: BigInt(25), phaseLimit: BigInt(2), price: BigInt(25), start: BigInt(0), timestamp: BigInt(1), count: BigInt(0), supply: BigInt(10), max: BigInt(2), minted: BigInt(0), owner: market, proceeds: BigInt(0) };
let mintAccess: any = { plan: null };
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: noop, __esModule: true },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: noop, __esModule: true },
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
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { ...protocol, factory: market, artMarket: market, isTestnet: true }, artMarketAbi },
  "@/lib/nftTypes": require("../../lib/nftTypes"),
  "@/lib/artDelivery": require("../../lib/artDelivery"),
  "@tanstack/react-query": { useQuery: ({ queryKey }: { queryKey: string[] }) => ({ isLoading: false, isError: false, refetch: async () => {}, data: queryKey[0] === "item-detail" ? { item, isOwner: false } : queryKey[0] === "collection-state" ? state : queryKey[0] === "art-order" ? { order: null } : { listing: [market, "art-hash", BigInt(25), `0x${"0".repeat(40)}`, false], proceeds: BigInt(0) } }) },
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
