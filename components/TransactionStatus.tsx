"use client";
import { arcChain } from "@/lib/arcConfig";
import type { Hash } from "viem";

export default function TransactionStatus({ pending, error, hash }: { pending: boolean; error: string; hash: Hash | null }) {
  return <div aria-live="polite" className="space-y-2">{pending && <p role="status" className="text-sm text-[var(--muted-text)]">Confirm in your wallet, then wait for Arc to confirm…</p>}{error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</p>}{hash && <a href={`${arcChain.blockExplorers?.default.url}/tx/${hash}`} target="_blank" rel="noreferrer" className="block text-xs font-semibold text-[#b55fbe] underline">{pending ? "View pending transaction" : error ? "View transaction details" : "View confirmed transaction"} ↗</a>}</div>;
}
