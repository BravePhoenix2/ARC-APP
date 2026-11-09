"use client";

import { useState } from "react";
import type { useCollectionCreationPayment } from "@/hooks/useCollectionCreationPayment";
import { arcChain } from "@/lib/arcConfig";

const button = "gallery-button px-4 py-3 text-xs font-semibold text-white disabled:opacity-40";

export default function CollectionCreationPayment({ payment, disabled = false }: { payment: ReturnType<typeof useCollectionCreationPayment>; disabled?: boolean }) {
  const [enteredHash, setEnteredHash] = useState<string | null>(null);
  const hash = enteredHash ?? payment.recovery.record?.hash ?? "";
  return <section aria-label="Collection creation fee" className="mt-4 space-y-3 rounded-xl border border-[var(--border-soft)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span>One-time collection creation fee</span><span>5 test USDC</span></div>
    <p className="text-xs leading-6 text-[var(--muted-text)]">Paid directly to the platform wallet before creating your collection. Network gas is separate. This payment stays credited to your collection if creation needs a retry.</p>
    {payment.paid ? <p role="status" className="text-xs font-semibold">Creation fee paid. Create your collection below without paying this fee again.</p> : <>
      {payment.data?.recipient && <a href={`${arcChain.blockExplorers?.default.url}/address/${payment.data.recipient}`} target="_blank" rel="noreferrer" className="block break-all font-mono text-[10px] text-[#b55fbe] underline">Platform wallet: {payment.data.recipient}</a>}
      {payment.isLoading ? <p role="status" className="text-xs text-[var(--muted-text)]">Checking the collection creation fee…</p> : payment.isError ? <p role="alert" className="text-xs text-rose-500">{payment.error || payment.failureReason?.message || "The creation fee could not be loaded."} <button type="button" className="font-semibold underline" onClick={() => void payment.refetch()}>Retry fee check</button></p> : null}
      <button type="button" className={button} disabled={disabled || payment.busy || payment.isLoading || payment.isError || !payment.data || !payment.recovery.ready || !!payment.recovery.record || payment.requestPending} onClick={() => void payment.pay()}>{payment.busy ? "Confirming creation fee…" : "Pay 5 test USDC creation fee"}</button>
      {payment.recovery.record && <p role="status" className="text-xs leading-6 text-[var(--muted-text)]">A previous creation fee payment needs verification. Verify it below before paying again.</p>}
      {payment.requestPending && !payment.recovery.record && <p role="status" className="text-xs leading-6 text-[var(--muted-text)]">A creation fee payment request was started. Check your wallet for its transaction hash and verify it below before paying again.</p>}
      {(payment.recovery.storageUnavailable || payment.requestStorageUnavailable) && <p role="alert" className="text-xs leading-6">Keep the transaction hash below. This browser could not save it for recovery.</p>}
      {(payment.recovery.record?.hash || payment.hash) && <a href={`${arcChain.blockExplorers?.default.url}/tx/${payment.recovery.record?.hash || payment.hash}`} target="_blank" rel="noreferrer" className="block text-xs text-[#b55fbe] underline">View creation fee transaction ↗</a>}
      <details open={!!payment.recovery.record}><summary className="cursor-pointer text-xs font-semibold">Already paid? Verify payment</summary><label className="mt-3 block text-xs font-semibold">Creation fee transaction hash<input aria-label="Creation fee transaction hash" value={hash} maxLength={66} placeholder="0x…" onChange={(event) => setEnteredHash(event.target.value.trim())} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2.5 font-mono text-xs" /></label><button type="button" className="mt-3 rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-semibold disabled:opacity-40" disabled={disabled || payment.busy || !payment.recovery.ready || !/^0x[a-fA-F0-9]{64}$/.test(hash)} onClick={() => void payment.recover(hash)}>Verify creation fee — no new payment</button></details>
    </>}
    {payment.error && !payment.isError && <p role="alert" className="text-xs text-rose-500">{payment.error}</p>}
  </section>;
}
