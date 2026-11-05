import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Hash } from "viem";
import ts from "typescript";
import type { useProtocolTransaction as TransactionHook } from "../../hooks/useProtocolTransaction";

const require = createRequire(import.meta.url);
const walletA = `0x${"1".repeat(40)}`;
const walletB = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}` as Hash;
const account = { identity: "account-a", authenticated: true, headers: {} };
const wallet = { address: walletA, isConnected: true, isWrongNetwork: false, switchToArc: async () => {} };
let writes = 0;
let receipt: () => Promise<{ status: string; from: string }>;
let renderer: ReactTestRenderer | undefined;
let transaction!: ReturnType<typeof TransactionHook>;
const deps: Record<string, unknown> = {
  "wagmi": { usePublicClient: () => ({ waitForTransactionReceipt: () => receipt() }), useWriteContract: () => ({ writeContractAsync: async () => { writes++; return hash; } }) },
  "@/hooks/useWallet": { useWallet: () => wallet },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => account },
  "@/lib/arcConfig": { arcChain: { id: 5042002 } },
  "@/lib/protocol": { protocol: { isTestnet: true }, transactionError: (error: Error) => error.message },
  "@/lib/testerActivityQueue": { queueTesterActivity: () => {}, syncTesterActivity: async () => {} },
};
const source = readFileSync(new URL("../../hooks/useProtocolTransaction.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { useProtocolTransaction: typeof TransactionHook } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
function Harness() { transaction = output.exports.useProtocolTransaction(); return null; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }

beforeEach(() => { writes = 0; account.identity = "account-a"; wallet.address = walletA; receipt = async () => ({ status: "success", from: walletA }); });
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

test("changing wallet during a preflight check prevents submitting from the newly selected account", async () => {
  const check = deferred<void>();
  await act(async () => { renderer = create(React.createElement(Harness)); });
  let running!: Promise<void>;
  await act(async () => { running = transaction.run(async (write) => { await check.promise; return write({} as Parameters<typeof write>[0]); }); });
  account.identity = "account-b"; wallet.address = walletB;
  await act(async () => renderer!.update(React.createElement(Harness)));
  await act(async () => { check.resolve(); await running; });
  assert.equal(writes, 0, "preflight from one account must not submit through another wallet");
  assert.equal(transaction.hash, null); assert.equal(transaction.error, ""); assert.equal(transaction.pending, false);
});

test("a pending transaction finishing after account switch does not expose stale feedback in the new account", async () => {
  const confirmed = deferred<{ status: string; from: string }>(); receipt = () => confirmed.promise;
  await act(async () => { renderer = create(React.createElement(Harness)); });
  let running!: Promise<void>; let savedHash: Hash | undefined;
  await act(async () => { running = transaction.run(async (write) => write({} as Parameters<typeof write>[0]), async (value) => { savedHash = value; throw new Error("Old account registration failed"); }); });
  assert.equal(transaction.hash, hash); assert.equal(transaction.pending, true);
  account.identity = "account-b"; wallet.address = walletB;
  await act(async () => renderer!.update(React.createElement(Harness)));
  assert.equal(transaction.hash, null); assert.equal(transaction.error, "");
  await act(async () => { confirmed.resolve({ status: "success", from: walletA }); await running; });
  assert.equal(savedHash, hash, "the original recovery callback retains its submitted hash");
  assert.equal(transaction.error, ""); assert.equal(transaction.hash, null); assert.equal(transaction.pending, false);
});
