"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hash } from "viem";
import { readPendingRegistration, transactionRecoveryKey, type PendingRegistration, type TransactionRecoveryScope } from "@/lib/transactionRecovery";

function readStored(key: string | null) {
  if (!key) return null;
  try { return typeof localStorage === "undefined" ? null : readPendingRegistration(localStorage.getItem(key)); } catch { return null; }
}

export function useTransactionRecovery(scope: TransactionRecoveryScope | null) {
  const key = scope ? transactionRecoveryKey(scope) : null;
  const currentKey = useRef(key); currentKey.current = key;
  const [state, setState] = useState<{ key: string | null; ready: boolean; record: PendingRegistration | null; storageUnavailable: boolean }>({ key: null, ready: false, record: null, storageUnavailable: false });
  useEffect(() => {
    const load = () => setState({ key, ready: true, record: readStored(key), storageUnavailable: false });
    load();
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  const capture = useCallback((hash: Hash, contractAddress: Address) => {
    if (!key) throw new Error("Sign in and select the verified wallet before saving transaction recovery.");
    const record: PendingRegistration = { hash, contractAddress, submittedAt: Date.now() };
    let storageUnavailable = false;
    try { localStorage.setItem(key, JSON.stringify(record)); } catch { storageUnavailable = true; }
    if (currentKey.current === key) setState({ key, ready: true, record, storageUnavailable });
  }, [key]);
  const clear = useCallback((hash?: Hash) => {
    if (!key) return;
    const stored = readStored(key);
    if (!hash || stored?.hash.toLowerCase() === hash.toLowerCase()) {
      try { localStorage.removeItem(key); } catch { /* The server remains authoritative. */ }
    }
    if (currentKey.current === key) setState((current) => {
      if (current.key !== key || !current.record || (hash && current.record.hash.toLowerCase() !== hash.toLowerCase())) return current;
      return { ...current, record: null, storageUnavailable: false };
    });
  }, [key]);
  const ready = state.key === key && state.ready;
  const record = state.key === key ? state.record : null;
  const assertCanStart = useCallback(() => {
    if (!key || !ready) throw new Error("Wait for your transaction recovery to finish loading.");
    if (record || readStored(key)) throw new Error("A previous transaction needs verification. Recover it below before sending another transaction.");
  }, [key, ready, record]);
  return { key, ready, record, capture, clear, assertCanStart, isCurrent: () => currentKey.current === key, storageUnavailable: state.key === key && state.storageUnavailable };
}
