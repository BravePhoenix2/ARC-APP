import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import { artMarketAbi, COLLECTION_CREATION_FEE, protocol, usdcAmount } from "../../lib/protocol";
import { type PlatformFeeTerms } from "../../lib/platformFeeRead";
import { emptyArtDelivery } from "../../lib/artDelivery";
import CreatorMintControls from "../../components/CreatorMintControls";

const require = createRequire(import.meta.url);
const wallet = `0x${"1".repeat(40)}`;
const market = `0x${"2".repeat(40)}` as `0x${string}`;
const hash = `0x${"a".repeat(64)}`;
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new Map<string, string>();
let renderer: ReactTestRenderer | undefined;
let logins: number;
let connections: number;
let payments: number;
let saved: { txHash: string; delivery: typeof emptyArtDelivery } | undefined;
let lastWrite: Record<string, unknown> | undefined;
let saveFailure = false;
const account = { ready: true, authenticated: false, identity: "guest", walletAddress: undefined as string | undefined, headers: {}, login: () => { logins++; }, connectWallet: () => { connections++; } };
const tx = { isConnected: false, pending: false, isWrongNetwork: false, address: wallet, client: null as null | { readContract?: (parameters: { functionName: string }) => Promise<unknown>; getTransactionReceipt: (parameters: { hash: string }) => Promise<{ from: string; to: string; status: "success" | "reverted" }> }, error: "", hash: null, refetchBalance: async () => {}, switchToArc: async () => {}, setError: (error: string) => { tx.error = error; }, run: async (action: (write: (args: Record<string, unknown>) => Promise<string>) => Promise<string>, after: (hash: string) => Promise<void>) => {
  payments++;
  try { const result = await action(async (args) => { lastWrite = args; return hash; }); await after(result); }
  catch (error) { tx.error = (error as Error).message; }
} };
const item = { artMarketAddress: undefined as string | undefined, id: "approved", itemType: "NFT", title: "Approved item", creationMethod: "HUMAN", nftKind: "COLLECTIBLE", contractAddress: wallet as string | null, mintPriceUsdc: 25, priceUsdc: 25, maxSupply: 10, maxPerWallet: 2, sold: false, artListingId: "42" as string | null, artListingSeller: market, creator: { username: "Creator" } };
const state = { phase: 3, phaseCount: BigInt(0), phasePrice: BigInt(25), phaseLimit: BigInt(2), price: BigInt(25), start: BigInt(0), timestamp: BigInt(1), count: BigInt(0), supply: BigInt(10), max: BigInt(2), minted: BigInt(0), owner: market, proceeds: BigInt(0), mintSurchargeBps: BigInt(200) as bigint | undefined, managed: false, closed: false, reserved: BigInt(0), guaranteedMinted: BigInt(0) };
type MintAccessFixture = { plan: { root: string; frozenAt: string; guaranteedAllocation?: number; config?: import("../../lib/mintAccess").MintPhaseConfig } | null; entry: { tier: string }; proof: never[]; entries?: Array<{walletAddress: string; tier: string}> };
let mintAccess: MintAccessFixture = { plan: null, entry: { tier: "PENDING" }, proof: [] };
let feeTerms: PlatformFeeTerms | undefined = { legacy: false, bps: BigInt(250), recipient: market };
let feeError = false;
let feeContract: string | null = null;
let isOwner = false;
let factoryMintSurcharge: bigint | null | undefined = BigInt(200);
let factoryMintSurchargeError = false;
let factoryManagement = true;
let accessSaveFailure = false;
let accessActions: Array<Record<string, unknown>>;
let creationFeeRequests = 0;
const creationPayment = { paid: true, isError: false, isLoading: false, busy: false, error: "", failureReason: null,
  data: { recipient: market, amount: COLLECTION_CREATION_FEE.toString() },
  recovery: { key: "creation-payment", ready: true, record: null, storageUnavailable: false },
  requestPending: false, requestStorageUnavailable: false,
  pay: async () => { creationFeeRequests++; }, recover: async () => {}, refetch: async () => {}, hash: null,
};
const queryFunctions = new Map<string, () => Promise<unknown>>();
const noop = () => null;
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: noop, __esModule: true },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/MarketNav": { default: noop, __esModule: true },
  "@/components/ReviewerOnly": { default: noop, __esModule: true },
  "@/components/TransactionStatus": { default: noop, __esModule: true },
  "@/components/RegistrationRecovery": require("../../components/RegistrationRecovery"),
  "@/hooks/useTransactionRecovery": require("../../hooks/useTransactionRecovery"),
  "@/hooks/useCollectionCreationPayment": { useCollectionCreationPayment: () => creationPayment },
  "@/lib/transactionRecovery": require("../../lib/transactionRecovery"),
  "@/components/PlatformFeeBreakdown": require("../../components/PlatformFeeBreakdown"),
  "@/hooks/usePlatformFees": { usePlatformFees: (_client: unknown, address: string | null) => { feeContract = address; return { data: feeTerms, isError: feeError, refetch: async () => {} }; } },
  "@/components/WatchlistButton": { default: noop, __esModule: true },
  "@/components/ShareItemButton": { default: noop, __esModule: true },
  "@/components/CreatorLink": { default: noop, __esModule: true },
  "@/components/MintAccessPanel": { default: noop, __esModule: true },
  "@/components/CreatorMintControls": { default: CreatorMintControls, __esModule: true },
  "@/hooks/useMintAccess": { useMintAccess: () => ({ data: mintAccess, refetch: async () => {}, saveAsync: async (input: Record<string, unknown>) => { accessActions.push(input); if (accessSaveFailure) throw new Error("The confirmed mint update could not be saved. Retry verification."); } }) },
  "@/lib/mintAccess": require("../../lib/mintAccess"),
  "@/components/CollectionImageGallery": { default: noop, __esModule: true },
  "@/hooks/useProtocolTransaction": { useProtocolTransaction: () => tx },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
  "@/lib/protocol": { ...require("../../lib/protocol"), protocol: { ...protocol, factory: market, artMarket: market, isTestnet: true }, artMarketForItem: (item: { artMarketAddress?: string | null }) => item.artMarketAddress ? require("../../lib/protocol").artMarketForItem(item) : market, artMarketAbi },
  "@/lib/nftTypes": require("../../lib/nftTypes"),
  "@/lib/artDelivery": require("../../lib/artDelivery"),
  "@tanstack/react-query": { useQuery: ({ queryKey, queryFn }: { queryKey: string[]; queryFn: () => Promise<unknown> }) => { queryFunctions.set(queryKey[0], queryFn); return { isLoading: false, isError: queryKey[0] === "factory-mint-surcharge" && factoryMintSurchargeError, refetch: async () => {}, data: queryKey[0] === "item-detail" ? { item, isOwner, metadataUrl: "https://articmarket.xyz/api/items/approved/metadata" } : queryKey[0] === "collection-state" ? state : queryKey[0] === "factory-mint-surcharge" ? factoryMintSurcharge : queryKey[0] === "factory-mint-management" ? factoryManagement : queryKey[0] === "art-order" ? { order: null } : { listing: [market, "art-hash", BigInt(25), `0x${"0".repeat(40)}`, false], proceeds: BigInt(0) } }; } },
};
function load(file: string): React.ComponentType<{ id: string }> {
  const source = readFileSync(new URL(`../../components/${file}.tsx`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as { default: React.ComponentType<{ id: string }> } };
  new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
  return output.exports.default;
}
deps["@/components/CollectionCreationPayment"] = { default: load("CollectionCreationPayment"), __esModule: true };
const CollectionDetail = load("CollectionDetail");
const ArtCheckout = load("ArtCheckout");
beforeEach(() => {
  storage.clear();
  queryFunctions.clear();
  creationPayment.paid = true; creationPayment.isError = false;
  factoryMintSurchargeError = false; creationFeeRequests = 0;
  factoryManagement = true; accessActions = []; accessSaveFailure = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  logins = connections = payments = 0; saved = undefined; lastWrite = undefined; saveFailure = false;
  Object.assign(account, { authenticated: false, identity: "guest", walletAddress: undefined });
  Object.assign(tx, { isConnected: false, error: "", client: null });
  feeTerms = { legacy: false, bps: BigInt(250), recipient: market }; feeError = false; isOwner = false; factoryMintSurcharge = BigInt(200); item.artMarketAddress = undefined; item.contractAddress = wallet; item.artListingId = "42";
  Object.assign(state, { price: BigInt(25), mintSurchargeBps: BigInt(200), managed: false, closed: false, reserved: BigInt(0), guaranteedMinted: BigInt(0), start: BigInt(0), timestamp: BigInt(1), count: BigInt(0), supply: BigInt(10), owner: market });
  item.itemType = "NFT"; item.nftKind = "COLLECTIBLE"; mintAccess = { plan: null, entry: { tier: "PENDING" }, proof: [] }; Object.assign(state, { phase: 3, phaseCount: BigInt(0), phasePrice: BigInt(25), phaseLimit: BigInt(2) });
  globalThis.fetch = async (_url, options) => { saved = JSON.parse(options?.body as string); return saveFailure ? Response.json({ error: "Retry saving; do not pay again." }, { status: 503 }) : Response.json({ order: { id: "order" } }); };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });

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


test("allowlisted and public mints add the actual deployed buyer rate to their base prices", async () => {
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  feeTerms = { legacy: false, bps: BigInt(250), recipient: market };
  mintAccess = { plan: { root: hash, frozenAt: new Date().toISOString() }, entry: { tier: "ULTIMATE" }, proof: [] };
  Object.assign(state, { phase: 1, phasePrice: usdcAmount("5"), phaseLimit: BigInt(1), price: usdcAmount("25"), mintSurchargeBps: BigInt(175) });
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite?.functionName, "mintAllowlisted"); assert.deepEqual(lastWrite?.args, [BigInt(1), 1, []]); assert.equal(lastWrite?.value, usdcAmount("5.0875"));
  lastWrite = undefined; mintAccess.entry.tier = "PENDING";
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite, undefined); assert.match(tx.error, /does not have access/);
  state.phase = 3;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  const publicWrite = lastWrite as Record<string, unknown> | undefined;
  assert.equal(publicWrite?.functionName, "mint"); assert.equal(publicWrite?.value, usdcAmount("25.4375"));
});


test("mint breakdown tracks quantity and adds the deployed buyer surcharge", async () => {
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  feeTerms = { legacy: false, bps: BigInt(250), recipient: market };
  Object.assign(state, { phase: 1, phasePrice: usdcAmount("0.1"), phaseLimit: BigInt(2) });
  mintAccess = { plan: { root: hash, frozenAt: new Date().toISOString() }, entry: { tier: "ULTIMATE" }, proof: [] };
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => renderer!.root.findByProps({ id: "mint-quantity" }).props.onChange({ target: { value: "2" } }));
  const disclosure = renderer!.root.findByProps({ "aria-label": "Payment breakdown" });
  const text = disclosure.findAllByType("span").map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" ");
  for (const expected of ["Mint price", "0.2 USDC", "Collector platform fee (2%)", "0.004 USDC", "Total mint payment", "0.204 USDC", "Creator platform fee (2.5%)", "0.005 USDC", "Creator receives", "0.195 USDC", "Total platform fees", "0.009 USDC"]) assert.ok(text.includes(expected), expected);
  assert.equal(feeContract, item.contractAddress, "deployed collection terms must override the current factory terms");
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite?.value, usdcAmount("0.204"));
});

test("older and legacy collections keep their exact base mint payment", async () => {
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  Object.assign(state, { phase: 3, phasePrice: usdcAmount("5"), price: usdcAmount("5"), mintSurchargeBps: undefined });
  for (const terms of [{ legacy: false, bps: BigInt(250), recipient: market }, { legacy: true, bps: BigInt(0), recipient: null }] satisfies PlatformFeeTerms[]) {
    feeTerms = terms; lastWrite = undefined;
    await act(async () => { renderer?.unmount(); renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
    await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    const legacyWrite = lastWrite as Record<string, unknown> | undefined;
    assert.equal(legacyWrite?.value, usdcAmount("5"));
  }
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
  feeTerms = { legacy: false, bps: BigInt(250), recipient: market };
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  assert.equal(feeContract, market);
  const spans = renderer!.root.findByProps({ "aria-label": "Payment breakdown" }).findAllByType("span").map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" ");
  for (const text of ["Public mint price per token", "25 USDC", "Collector platform fee (2%)", "0.5 USDC", "Collector pays per token", "25.5 USDC", "Creator platform fee (2.5%)", "0.625 USDC", "Creator receives per token", "24.375 USDC", "Total platform fees", "1.125 USDC"]) assert.ok(spans.includes(text), text);
});

test("a verified legacy factory accepts direct payment credit and creates without a buyer surcharge or upgrade", async () => {
  item.contractAddress = null; isOwner = true; factoryMintSurcharge = BigInt(0);
  feeTerms = { legacy: true, bps: BigInt(0), recipient: null };
  creationPayment.paid = false;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const pay = renderer!.root.findAllByType("button").find((node) => node.props.children === "Pay 5 test USDC creation fee")!;
  assert.equal(pay.props.disabled, false);
  await act(async () => pay.props.onClick()); assert.equal(creationFeeRequests, 1);
  creationPayment.paid = true;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  const deploy = renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  assert.equal(deploy.props.disabled, false);
  await act(async () => { deploy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(lastWrite?.functionName, "create721"); assert.equal(lastWrite?.value, undefined);
});

test("an RPC failure blocks payment and creation even when a prior surcharge result was zero", async () => {
  item.contractAddress = null; isOwner = true; factoryMintSurcharge = BigInt(0); factoryMintSurchargeError = true;
  feeTerms = { legacy: true, bps: BigInt(0), recipient: null }; creationPayment.paid = false;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  tx.client = { readContract: async () => { throw new Error("Arc RPC unavailable"); }, getTransactionReceipt: async () => ({ from: wallet, to: market, status: "success" }) };
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  assert.equal(renderer!.root.findAllByType("button").find((node) => node.props.children === "Pay 5 test USDC creation fee")!.props.disabled, true);
  await assert.rejects(queryFunctions.get("factory-mint-surcharge")!(), /Arc RPC unavailable/);
  creationPayment.paid = true;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  const deploy = renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  assert.equal(deploy.props.disabled, true);
  await act(async () => { deploy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(lastWrite, undefined); assert.match(tx.error, /mint payment check/);
});

for (const kind of ["COLLECTIBLE", "EDITION", "SOULBOUND", "MEMBERSHIP"]) {
  for (const phased of [false, true]) test(`${kind} creation ${phased ? "with whitelist phases" : "with public minting"} uses verified direct-payment credit and sends no additional fee`, async () => {
    item.contractAddress = null; item.nftKind = kind; isOwner = true;
    Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
    tx.client = { readContract: async () => true, getTransactionReceipt: async () => ({ from: wallet, to: market, status: "success" }) };
    if (phased) mintAccess.plan = { root: hash, frozenAt: new Date().toISOString(), config: {
      ultimateStart: "2027-01-01T10:00:00Z", fcfsStart: "2027-01-01T11:00:00Z", publicStart: "2027-01-01T12:00:00Z",
      ultimateLimit: 1, fcfsLimit: 1, publicLimit: 1, ultimatePrice: "1", fcfsPrice: "2",
    } };
    await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
    const disclosure = renderer!.root.findByProps({ "aria-label": "Collection creation fee" });
    assert.ok(disclosure.findAllByType("span").some((node) => node.children.includes("5 test USDC")));
    assert.match(JSON.stringify(renderer!.toJSON()), /Network gas is separate/);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Approved · awaiting/);
    const deploy = renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
    assert.equal(deploy.props.disabled, false);
    await act(async () => { deploy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(payments, 1);
    assert.equal(lastWrite?.functionName, `${kind === "EDITION" ? "createEdition" : "create721"}${phased ? "WithManagedPhases" : ""}`);
    assert.equal(lastWrite?.value, undefined);
    assert.equal((lastWrite?.args as unknown[])[3], usdcAmount("25"), "the collection fee is separate from the collector's mint price");
    if (kind !== "EDITION") assert.equal((lastWrite?.args as unknown[])[8], kind === "SOULBOUND");
  });
}

for (const failed of [false, true]) test(`collection creation is blocked without confirmed fee credit (API failure: ${failed})`, async () => {
  item.contractAddress = null; isOwner = true; creationPayment.paid = false; creationPayment.isError = failed;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const deploy = renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  assert.equal(deploy.props.disabled, true);
  await act(async () => { deploy.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(lastWrite, undefined);
  assert.match(tx.error, /Pay and verify the 5 test USDC creation fee/);
});

test("an unavailable creation fee does not block minting an already deployed collection", async () => {
  creationPayment.paid = false; creationPayment.isError = true;
  Object.assign(account, { authenticated: true, identity: "collector", walletAddress: wallet }); tx.isConnected = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  assert.equal(renderer!.root.findAllByProps({ "aria-label": "Collection creation fee" }).length, 0);
  await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(lastWrite?.functionName, "mint");
});


test("a confirmed collection deployment survives reload and retries registration without another wallet transaction", async () => {
  item.contractAddress = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  tx.client = { getTransactionReceipt: async () => ({ from: wallet, to: market, status: "success" }) };
  saveFailure = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const deploymentButton = () => renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  assert.equal(deploymentButton().props.disabled, false);
  await act(async () => { deploymentButton().props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(payments, 1); assert.equal(lastWrite?.functionName, "create721"); assert.equal(lastWrite?.value, undefined);
  assert.equal(storage.size, 1); assert.match([...storage.values()][0], new RegExp(hash));
  await act(async () => { renderer!.unmount(); renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  assert.equal(deploymentButton().props.disabled, true, "reload must not offer a second deployment while registration is unresolved");
  assert.equal(renderer!.root.findByProps({ "aria-label": "Collection deployment transaction hash" }).props.value, hash);
  saveFailure = false;
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save deployment")!.props.onClick(); });
  assert.equal(saved?.txHash, hash); assert.equal(payments, 1, "recovering a receipt must never request another wallet payment");
  item.contractAddress = wallet;
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  assert.equal(storage.size, 0, "registration is forgotten only after the item shows its saved contract");
});

test("art checkout activation preserves its hash on API failure and recovers after reload", async () => {
  item.itemType = "WEB2_ART"; item.artListingId = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  tx.client = { getTransactionReceipt: async () => ({ from: wallet, to: market, status: "success" }) };
  saveFailure = true;
  await act(async () => { renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  const activationButton = () => renderer!.root.findAllByType("button").find((node) => node.props.children === "Activate artwork checkout")!;
  await act(async () => { activationButton().props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(lastWrite?.functionName, "createListing"); assert.equal(payments, 1);
  await act(async () => { renderer!.unmount(); renderer = create(React.createElement(ArtCheckout, { id: item.id })); });
  assert.equal(activationButton().props.disabled, true);
  saveFailure = false;
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save listing")!.props.onClick(); });
  assert.equal(saved?.txHash, hash); assert.equal(payments, 1);
  assert.ok([...storage.values()].every((raw) => !raw.includes("delivery") && !raw.includes("recipient")), "recovery must not store delivery details");
  item.artListingId = "42";
  await act(async () => renderer!.update(React.createElement(ArtCheckout, { id: item.id })));
  assert.equal(storage.size, 0);
});

test("another account or wallet cannot see a saved deployment recovery record", async () => {
  item.contractAddress = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  saveFailure = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => { renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!.props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  Object.assign(account, { identity: "other-account" });
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  assert.equal(renderer!.root.findByProps({ "aria-label": "Collection deployment transaction hash" }).props.value, "");
  Object.assign(account, { identity: "creator", walletAddress: `0x${"9".repeat(40)}` });
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  assert.equal(renderer!.root.findByProps({ "aria-label": "Collection deployment transaction hash" }).props.value, "");
  Object.assign(account, { walletAddress: wallet });
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  assert.equal(renderer!.root.findByProps({ "aria-label": "Collection deployment transaction hash" }).props.value, hash);
});

test("a verified reverted deployment can be cleared; a different wallet receipt cannot be attached", async () => {
  item.contractAddress = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  saveFailure = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const deploy = () => renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  await act(async () => { deploy().props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  tx.client = { getTransactionReceipt: async () => ({ from: market, to: market, status: "success" }) };
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  saved = undefined;
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save deployment")!.props.onClick(); });
  assert.equal(saved, undefined); assert.match(tx.error, /different wallet/); assert.equal(deploy().props.disabled, true);
  tx.client = { getTransactionReceipt: async () => ({ from: wallet, to: market, status: "reverted" }) };
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save deployment")!.props.onClick(); });
  assert.equal(storage.size, 0); assert.equal(deploy().props.disabled, false); assert.equal(payments, 1);
});

test("an unavailable receipt keeps its saved recovery record and cannot trigger another deployment", async () => {
  item.contractAddress = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  saveFailure = true;
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  const deploy = () => renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!;
  await act(async () => { deploy().props.onClick(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  tx.client = { getTransactionReceipt: async () => { throw new Error("Transaction receipt is not available yet"); } };
  await act(async () => renderer!.update(React.createElement(CollectionDetail, { id: item.id })));
  saved = undefined;
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save deployment")!.props.onClick(); });
  assert.equal(storage.size, 1); assert.equal(deploy().props.disabled, true); assert.equal(payments, 1); assert.equal(saved, undefined);
});

test("a manually entered receipt rejected by server verification does not block a valid new deployment", async () => {
  item.contractAddress = null; isOwner = true;
  Object.assign(account, { authenticated: true, identity: "creator", walletAddress: wallet }); tx.isConnected = true;
  tx.client = { getTransactionReceipt: async () => ({ from: wallet, to: market, status: "success" }) };
  globalThis.fetch = async () => Response.json({ error: "This receipt does not match the approved collection." }, { status: 400 });
  await act(async () => { renderer = create(React.createElement(CollectionDetail, { id: item.id })); });
  await act(async () => renderer!.root.findByProps({ "aria-label": "Collection deployment transaction hash" }).props.onChange({ target: { value: hash } }));
  await act(async () => { await renderer!.root.findAllByType("button").find((node) => node.props.children === "Verify and save deployment")!.props.onClick(); });
  assert.match(tx.error, /does not match/); assert.equal(storage.size, 0); assert.equal(payments, 0);
  assert.equal(renderer!.root.findAllByType("button").find((node) => node.props.children === "Create collection")!.props.disabled, false);
});
