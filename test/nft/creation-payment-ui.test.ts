import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as reactQuery from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type Hash } from "viem";
import ts from "typescript";
import { COLLECTION_CREATION_FEE } from "../../lib/protocol";
import { collectionCreationFeeData } from "../../lib/collectionCreationFee";
import type { useCollectionCreationPayment as PaymentHook } from "../../hooks/useCollectionCreationPayment";

const require = createRequire(import.meta.url);
const wallet = `0x${"1".repeat(40)}` as const;
const otherWallet = `0x${"9".repeat(40)}` as const;
const treasury = `0x${"2".repeat(40)}` as const;
const hash = `0x${"a".repeat(64)}` as Hash;
const replacementHash = `0x${"b".repeat(64)}` as Hash;
const itemId = "collection-setup";
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new Map<string, string>();
let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;
let payment: ReturnType<typeof PaymentHook>;
let account: { authenticated: boolean; identity: string; walletAddress: string; headers: Record<string, string>; login: () => void; connectWallet: () => void };
let sent: Array<Record<string, unknown>>;
let posted: Array<{ txHash: string }>;
let paid: boolean;
let verifyUnavailable: boolean;
let estimateFailure: Error | undefined;
let sendFailure: Error | undefined;
let waitFailure: Error | undefined;
let sendGate: Promise<Hash> | undefined;
let sendStarted: (() => void) | undefined;
let invoiceOverride: Record<string, unknown>;
let receiptStatus: "success" | "reverted";
let receiptWallet: string;
let replacement: "cancelled" | "repriced" | null;
let estimates: number;

function status() {
  return { paid, amount: COLLECTION_CREATION_FEE.toString(), recipient: treasury, chainId: 5042002, paymentData: collectionCreationFeeData(itemId),
    payment: paid ? { txHash: posted.at(-1)?.txHash || hash, payerWallet: wallet, recipientWallet: treasury, amount: COLLECTION_CREATION_FEE.toString(), chainId: 5042002, paidAt: new Date().toISOString() } : null,
    ...invoiceOverride,
  };
}
const client = {
  estimateGas: async () => { estimates++; if (estimateFailure) throw estimateFailure; return BigInt(30_000); },
  getTransactionReceipt: async ({ hash: txHash }: { hash: Hash }) => ({ from: receiptWallet, to: treasury, status: receiptStatus, transactionHash: txHash }),
  waitForTransactionReceipt: async ({ hash: txHash, onReplaced }: { hash: Hash; onReplaced: (value: unknown) => void }) => {
    if (waitFailure) throw waitFailure;
    if (replacement) {
      const cancelled = replacement === "cancelled";
      const receipt = { from: wallet, to: cancelled ? wallet : treasury, status: "success", transactionHash: replacementHash };
      onReplaced({ reason: replacement, transaction: { from: wallet, to: cancelled ? wallet : treasury, value: cancelled ? BigInt(0) : COLLECTION_CREATION_FEE, hash: replacementHash }, transactionReceipt: receipt });
      return receipt;
    }
    return { from: wallet, to: treasury, status: receiptStatus, transactionHash: txHash };
  },
};
const dependencies: Record<string, unknown> = {
  "@tanstack/react-query": reactQuery,
  "wagmi": { useSendTransaction: () => ({ sendTransactionAsync: async (request: Record<string, unknown>) => {
    sent.push(request); sendStarted?.(); if (sendFailure) throw sendFailure; return sendGate ? await sendGate : hash;
  } }) },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/hooks/useTransactionRecovery": require("../../hooks/useTransactionRecovery"),
  "@/lib/collectionCreationFee": { collectionCreationFeeData },
  "@/lib/protocol": require("../../lib/protocol"),
  "@/lib/arcConfig": { arcChain: { id: 5042002, blockExplorers: { default: { url: "https://explorer.testnet.arc.io" } } } },
};
function load<T>(path: string): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as T };
  new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
  return output.exports;
}
const { useCollectionCreationPayment } = load<{ useCollectionCreationPayment: typeof PaymentHook }>("../../hooks/useCollectionCreationPayment.ts");
const Panel = load<{ default: React.ComponentType<{ payment: ReturnType<typeof PaymentHook> }> }>("../../components/CollectionCreationPayment.tsx").default;
function Probe() {
  payment = useCollectionCreationPayment(itemId, true, client as unknown as Parameters<typeof PaymentHook>[2], true, false);
  return React.createElement(Panel, { payment });
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); }); }
async function render() {
  await act(async () => {
    const tree = React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(Probe));
    if (renderer) renderer.update(tree); else renderer = create(tree);
  });
  await settle();
}
async function reload() {
  await act(async () => renderer?.unmount()); renderer = undefined;
  queryClient.clear();
  await render();
}
async function pay() { await act(async () => { await payment.pay(); }); await settle(); }
const payButton = () => renderer!.root.findAllByType("button").find((node) => node.children.includes("Pay 5 test USDC creation fee"))!;
const text = () => JSON.stringify(renderer!.toJSON());

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  sent = []; posted = []; paid = false; verifyUnavailable = false; estimates = 0;
  estimateFailure = sendFailure = waitFailure = undefined; sendGate = undefined; sendStarted = undefined; invoiceOverride = {};
  receiptStatus = "success"; receiptWallet = wallet; replacement = null;
  storage.clear();
  account = { authenticated: true, identity: "creator", walletAddress: wallet, headers: { "X-Artiq-Account-ID": "creator", "X-Wallet-Address": wallet }, login() {}, connectWallet() {} };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/creation-fee$/, "only in-process payment fixtures may be requested");
    if (options?.method === "POST") {
      posted.push(JSON.parse(String(options.body)));
      if (verifyUnavailable) return Response.json({ error: "Payment verification is temporarily unavailable. Retry verification without paying again." }, { status: 503 });
      paid = true;
    }
    return Response.json(status());
  };
});
afterEach(async () => {
  await act(async () => renderer?.unmount()); renderer = undefined; queryClient.clear();
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage");
});

test("pays exactly 5 native test USDC directly to the verified platform wallet with its collection tag", async () => {
  await render(); await pay();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { to: treasury, value: COLLECTION_CREATION_FEE, data: collectionCreationFeeData(itemId), account: wallet, chainId: 5042002 });
  assert.equal(estimates, 1);
  assert.deepEqual(posted, [{ txHash: hash }]);
  assert.equal(payment.paid, true); assert.equal(storage.size, 0);
  assert.match(text(), /Creation fee paid/);
  assert.match(text(), /directly to the platform wallet/);
});

test("confirmed credit survives reload and another linked wallet without another fee", async () => {
  await render(); await pay(); await reload(); await pay();
  account = { ...account, walletAddress: otherWallet, headers: { ...account.headers, "X-Wallet-Address": otherWallet } };
  await render(); await pay();
  assert.equal(payment.paid, true); assert.equal(sent.length, 1);
});

test("API verification failure preserves its hash across reload and recovery never requests another transfer", async () => {
  verifyUnavailable = true;
  await render(); await pay();
  assert.equal(payment.paid, false); assert.equal(sent.length, 1);
  assert.equal(payment.recovery.record?.hash, hash);
  await reload(); assert.equal(payButton().props.disabled, true);
  verifyUnavailable = false;
  await act(async () => { await payment.recover(hash); }); await settle();
  assert.equal(payment.paid, true); assert.equal(sent.length, 1); assert.equal(storage.size, 0);
});

test("an unavailable receipt retains the saved hash and blocks another payment", async () => {
  waitFailure = new Error("Receipt unavailable");
  await render(); await pay(); await reload();
  assert.equal(payment.recovery.record?.hash, hash); assert.equal(payButton().props.disabled, true);
  await pay(); assert.equal(sent.length, 1); assert.equal(posted.length, 0);
});

test("a confirmed reverted fee can be retried without losing collection setup", async () => {
  receiptStatus = "reverted";
  await render(); await pay();
  assert.equal(payment.paid, false); assert.equal(storage.size, 0); assert.equal(payButton().props.disabled, false);
  receiptStatus = "success"; await pay();
  assert.equal(payment.paid, true); assert.equal(sent.length, 2);
});

test("unknown send failures retain an uncertainty marker across reload and prohibit duplicate payment", async () => {
  sendFailure = new Error("Transport disconnected after submission");
  await render(); await pay();
  assert.equal(payment.requestPending, true); assert.equal(payment.recovery.record, null);
  assert.equal(payButton().props.disabled, true);
  await reload(); sendFailure = undefined; await pay();
  assert.equal(sent.length, 1); assert.equal(payment.requestPending, true);
  await act(async () => { await payment.recover(hash); }); await settle();
  assert.equal(payment.paid, true); assert.equal(sent.length, 1); assert.equal(storage.size, 0);
});

test("explicit wallet rejection clears the request marker so the creator can retry", async () => {
  sendFailure = Object.assign(new Error("Rejected by wallet"), { code: 4001 });
  await render(); await pay();
  assert.equal(payment.requestPending, false); assert.equal(storage.size, 0);
  sendFailure = undefined; await pay();
  assert.equal(payment.paid, true); assert.equal(sent.length, 2);
});

test("insufficient funds discovered by read-only estimation never starts an uncertain wallet request", async () => {
  estimateFailure = Object.assign(new Error("Insufficient funds"), { name: "InsufficientFundsError" });
  await render(); await pay();
  assert.equal(sent.length, 0); assert.equal(storage.size, 0); assert.equal(payment.requestPending, false);
  estimateFailure = undefined; await pay(); assert.equal(sent.length, 1); assert.equal(payment.paid, true);
});

test("confirmed cancellation consumes the original nonce and allows a new payment", async () => {
  replacement = "cancelled";
  await render(); await pay();
  assert.equal(payment.paid, false); assert.equal(posted.length, 0); assert.equal(storage.size, 0);
  assert.match(payment.error, /cancelled/);
  replacement = null; await pay(); assert.equal(payment.paid, true); assert.equal(sent.length, 2);
});

test("a repriced transfer verifies its replacement hash without sending another fee", async () => {
  replacement = "repriced";
  await render(); await pay();
  assert.equal(payment.paid, true); assert.deepEqual(posted, [{ txHash: replacementHash }]); assert.equal(sent.length, 1);
});

test("recovery rejects another payer and keeps the unresolved hash", async () => {
  verifyUnavailable = true; await render(); await pay();
  posted.length = 0; receiptWallet = otherWallet;
  await act(async () => { await payment.recover(hash); });
  assert.equal(posted.length, 0); assert.match(payment.error, /different wallet/); assert.equal(payment.recovery.record?.hash, hash);
});

test("changing wallet during the prompt preserves the original recovery scope and never verifies as the new wallet", async () => {
  let finish!: (hash: Hash) => void;
  sendGate = new Promise((resolve) => { finish = resolve; });
  let started!: () => void; const requested = new Promise<void>((resolve) => { started = resolve; }); sendStarted = started;
  await render(); let work!: Promise<void>;
  await act(async () => { work = payment.pay(); await requested; });
  account = { ...account, walletAddress: otherWallet, headers: { ...account.headers, "X-Wallet-Address": otherWallet } };
  await render();
  await act(async () => { finish(hash); await work; }); await settle();
  const otherWalletRecord = payment.recovery.record;
  assert.equal(posted.length, 0); assert.equal(otherWalletRecord, null);
  account = { ...account, walletAddress: wallet, headers: { ...account.headers, "X-Wallet-Address": wallet } };
  await render(); assert.equal(payment.recovery.record?.hash, hash); assert.equal(sent.length, 1);
});

for (const [label, value] of [
  ["amount", { amount: (COLLECTION_CREATION_FEE + BigInt(1)).toString() }],
  ["recipient", { recipient: `0x${"0".repeat(40)}` }],
  ["chain", { chainId: 1 }], ["collection tag", { paymentData: "0x1234" }],
] as const) test(`an invalid server ${label} prevents a wallet payment`, async () => {
  invoiceOverride = value;
  await render(); await pay();
  assert.equal(sent.length, 0); assert.equal(payment.paid, false); assert.equal(storage.size, 0);
});
