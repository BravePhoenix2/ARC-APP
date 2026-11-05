import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Address, Hash } from "viem";
import { readPendingRegistration, transactionRecoveryKey, type TransactionRecoveryScope } from "../../lib/transactionRecovery";
import type { useTransactionRecovery as RecoveryHook } from "../../hooks/useTransactionRecovery";

const require = createRequire(import.meta.url);
const { useTransactionRecovery } = require("../../hooks/useTransactionRecovery") as { useTransactionRecovery: typeof RecoveryHook };
const wallet = `0x${"1".repeat(40)}`;
const contract = `0x${"2".repeat(40)}` as Address;
const hashA = `0x${"a".repeat(64)}` as Hash;
const hashB = `0x${"b".repeat(64)}` as Hash;
const storage = new Map<string, string>();
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let renderer: ReactTestRenderer | undefined;
let recovery!: ReturnType<typeof RecoveryHook>;
function Harness({ scope }: { scope: TransactionRecoveryScope }) { recovery = useTransactionRecovery(scope); return null; }
const scopeA: TransactionRecoveryScope = { accountId: "account-a", walletAddress: wallet, chainId: 5042002, itemId: "item-a", operation: "collection-deployment" };

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage); else Reflect.deleteProperty(globalThis, "localStorage"); });

test("late recovery callbacks retain their original account scope and cannot replace the selected account's state", async () => {
  await act(async () => { renderer = create(React.createElement(Harness, { scope: scopeA })); });
  const oldAccountRecovery = recovery;
  const scopeB = { ...scopeA, accountId: "account-b" };
  await act(async () => renderer!.update(React.createElement(Harness, { scope: scopeB })));
  await act(async () => recovery.capture(hashB, contract));
  await act(async () => oldAccountRecovery.capture(hashA, contract));
  assert.equal(recovery.record?.hash, hashB);
  assert.equal(readPendingRegistration(storage.get(transactionRecoveryKey(scopeA)) ?? null)?.hash, hashA);
  await act(async () => oldAccountRecovery.clear(hashA));
  assert.equal(recovery.record?.hash, hashB);
  assert.equal(readPendingRegistration(storage.get(transactionRecoveryKey(scopeB)) ?? null)?.hash, hashB);
});

test("a stale registration completion cannot clear a newer saved hash", async () => {
  await act(async () => { renderer = create(React.createElement(Harness, { scope: scopeA })); });
  await act(async () => recovery.capture(hashA, contract));
  const firstCompletion = recovery.clear;
  await act(async () => recovery.capture(hashB, contract));
  await act(async () => firstCompletion(hashA));
  assert.equal(recovery.record?.hash, hashB);
  assert.equal(readPendingRegistration(storage.get(transactionRecoveryKey(scopeA)) ?? null)?.hash, hashB);
});

test("pending deployment recovery remains available after a long absence and is isolated by item, chain, and operation", () => {
  const old = JSON.stringify({ hash: hashA, contractAddress: contract, submittedAt: 1 });
  assert.equal(readPendingRegistration(old)?.hash, hashA, "unresolved transactions must not silently expire into another deployment");
  for (const scope of [{ ...scopeA, itemId: "item-b" }, { ...scopeA, chainId: 5042 }, { ...scopeA, operation: "art-listing" as const }]) assert.notEqual(transactionRecoveryKey(scope), transactionRecoveryKey(scopeA));
  for (const raw of ["{}", "not json", JSON.stringify({ hash: hashA, contractAddress: "invalid", submittedAt: 1 })]) assert.equal(readPendingRegistration(raw), null);
});

test("blocked browser storage preserves in-memory recovery and reports that reload recovery needs the saved hash", async () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Storage access denied"); } });
  await act(async () => { renderer = create(React.createElement(Harness, { scope: scopeA })); });
  assert.equal(recovery.ready, true);
  await act(async () => recovery.capture(hashA, contract));
  assert.equal(recovery.record?.hash, hashA); assert.equal(recovery.storageUnavailable, true);
  assert.throws(() => recovery.assertCanStart(), /previous transaction needs verification/);
});
