"use client";

import React, { useState } from "react";
import type { Hash } from "viem";
import { arcChain } from "@/lib/arcConfig";

export default function RegistrationRecovery({ operation, hash, busy, disabled, storageUnavailable, onRecover }: {
  operation: "deployment" | "listing"; hash: Hash | null; busy: boolean; disabled: boolean; storageUnavailable: boolean;
  onRecover: (hash: string) => Promise<void>;
}) {
  const [enteredHash, setEnteredHash] = useState<string | null>(null);
  const value = enteredHash ?? hash ?? "";
  return <div className="mt-4 rounded-xl border border-[var(--border-soft)] p-4" aria-label={`Recover ${operation}`}>
    {hash && <><p className="text-xs font-semibold">A previous {operation} needs verification.</p><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Check and save this transaction before sending another. Recovery never requests a wallet payment.</p><a className="mt-2 block break-all font-mono text-[10px] text-[#b55fbe] underline" href={`${arcChain.blockExplorers?.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">View saved transaction ↗</a></>}
    {storageUnavailable && <p role="alert" className="mt-2 text-xs leading-6">This browser could not save the transaction locally. Keep its hash or explorer link so you can recover it after a refresh.</p>}
    <details open={!!hash} className="mt-2"><summary className="cursor-pointer text-xs font-semibold">Already submitted? Recover {operation}</summary><label className="mt-3 block text-xs font-semibold">{operation === "deployment" ? "Collection deployment" : "Listing activation"} transaction hash<input aria-label={`${operation === "deployment" ? "Collection deployment" : "Listing activation"} transaction hash`} value={value} maxLength={66} placeholder="0x…" onChange={(event) => setEnteredHash(event.target.value.trim())} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2.5 font-mono text-xs" /></label><button type="button" disabled={busy || disabled || !/^0x[a-fA-F0-9]{64}$/.test(value)} className="mt-3 rounded-full border border-[var(--border-soft)] px-4 py-2.5 text-xs font-semibold disabled:opacity-40" onClick={() => void onRecover(value)}>{busy ? "Verifying and saving…" : `Verify and save ${operation}`}</button></details>
  </div>;
}
