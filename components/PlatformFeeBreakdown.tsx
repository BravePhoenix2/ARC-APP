"use client";

import React from "react";
import { displayUsdc, formatFeePercent, splitPlatformFee } from "@/lib/protocol";
import { type PlatformFeeTerms } from "@/lib/platformFeeRead";

type Props = {
  terms?: PlatformFeeTerms;
  gross?: bigint;
  isError?: boolean;
  onRetry?: () => void;
  proceedsLabel?: string;
  totalLabel?: string;
  auction?: boolean;
};

export default function PlatformFeeBreakdown({ terms, gross, isError, onRetry, proceedsLabel = "Creator receives", totalLabel = "Total payment", auction = false }: Props) {
  const amounts = terms && gross !== undefined ? splitPlatformFee(gross, terms.bps) : undefined;
  return <div className="my-4 rounded-xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-4 text-xs leading-6" aria-label="Payment breakdown">
    {gross !== undefined && <p className="flex justify-between gap-3 font-semibold"><span>{totalLabel}</span><span>{displayUsdc(gross)} USDC</span></p>}
    {isError ? <p role="alert">Platform fee could not be verified. <button type="button" onClick={onRetry} className="font-semibold underline">Retry fee check</button></p> : !terms ? <p role="status">Checking the deployed platform fee…</p> : <>
      <p className="flex justify-between gap-3"><span>Platform fee ({formatFeePercent(terms.bps)})</span><span>{amounts ? `${displayUsdc(amounts.platformFee)} USDC` : "Deducted from each sale"}</span></p>
      {amounts && <p className="flex justify-between gap-3"><span>{auction ? "Seller proceeds before royalties" : proceedsLabel}</span><span>{displayUsdc(amounts.net)} USDC</span></p>}
      {terms.legacy && <p className="mt-1 text-[var(--muted-text)]">Legacy deployment · no platform fee.</p>}
      {!terms.legacy && <p className="mt-1 text-[var(--muted-text)]">The platform fee is included in the payment and deducted from proceeds.</p>}
      {terms.recipient && <p className="mt-1 break-all text-[10px] text-[var(--muted-text)]">Platform fee wallet: {terms.recipient}</p>}
    </>}
    {auction && <p className="mt-1 text-[var(--muted-text)]">Creator royalties are separate. Applicable ERC-2981 royalties are also deducted at settlement; the seller receives the remainder.</p>}
    <p className="mt-1 text-[var(--muted-text)]">Network gas is separate and shown by your wallet before confirmation.</p>
  </div>;
}
