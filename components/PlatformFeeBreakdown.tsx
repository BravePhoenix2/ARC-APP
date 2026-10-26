"use client";

import React from "react";
import { addPlatformFee, displayUsdc, formatFeePercent, splitPlatformFee } from "@/lib/protocol";
import { type PlatformFeeTerms } from "@/lib/platformFeeRead";

type Props = {
  terms?: PlatformFeeTerms;
  gross?: bigint;
  isError?: boolean;
  onRetry?: () => void;
  baseLabel?: string;
  proceedsLabel?: string;
  totalLabel?: string;
  auction?: boolean;
  mintSurchargeBps?: bigint;
};

export default function PlatformFeeBreakdown({ terms, gross, isError, onRetry, baseLabel = "Mint price", proceedsLabel, totalLabel, auction = false, mintSurchargeBps }: Props) {
  const mintSurcharge = mintSurchargeBps !== undefined;
  const creatorAmounts = terms && gross !== undefined ? splitPlatformFee(gross, terms.bps) : undefined;
  const surchargeAmounts = mintSurcharge && gross !== undefined ? addPlatformFee(gross, mintSurchargeBps) : undefined;
  const proceeds = proceedsLabel || "Creator receives";
  const total = totalLabel || (mintSurcharge ? "Total mint payment" : "Total payment");
  const platformTotal = creatorAmounts && surchargeAmounts ? creatorAmounts.platformFee + surchargeAmounts.platformFee : undefined;
  return <div className="my-4 rounded-xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-4 text-xs leading-6" aria-label="Payment breakdown">
    {gross !== undefined && <p className="flex justify-between gap-3 font-semibold"><span>{mintSurcharge ? baseLabel : total}</span><span>{displayUsdc(gross)} USDC</span></p>}
    {isError ? <p role="alert">Platform fee could not be verified. <button type="button" onClick={onRetry} className="font-semibold underline">Retry fee check</button></p> : !terms ? <p role="status">Checking the deployed platform fee…</p> : <>
      {mintSurcharge ? <>
        <p className="flex justify-between gap-3"><span>Collector platform fee ({formatFeePercent(mintSurchargeBps)})</span><span>{surchargeAmounts ? `${displayUsdc(surchargeAmounts.platformFee)} USDC` : "Added to each mint"}</span></p>
        {surchargeAmounts && <p className="flex justify-between gap-3 font-semibold"><span>{total}</span><span>{displayUsdc(surchargeAmounts.total)} USDC</span></p>}
        <p className="mt-2 flex justify-between gap-3"><span>Creator platform fee ({formatFeePercent(terms.bps)})</span><span>{creatorAmounts ? `${displayUsdc(creatorAmounts.platformFee)} USDC` : "Deducted from the mint price"}</span></p>
        {creatorAmounts && <p className="flex justify-between gap-3"><span>{proceeds}</span><span>{displayUsdc(creatorAmounts.net)} USDC</span></p>}
        {platformTotal !== undefined && <p className="flex justify-between gap-3"><span>Total platform fees</span><span>{displayUsdc(platformTotal)} USDC</span></p>}
      </> : <>
        <p className="flex justify-between gap-3"><span>Platform fee ({formatFeePercent(terms.bps)})</span><span>{creatorAmounts ? `${displayUsdc(creatorAmounts.platformFee)} USDC` : "Deducted from each sale"}</span></p>
        {creatorAmounts && <p className="flex justify-between gap-3"><span>{auction ? "Seller proceeds before royalties" : proceeds}</span><span>{displayUsdc(creatorAmounts.net)} USDC</span></p>}
      </>}
      {terms.legacy && <p className="mt-1 text-[var(--muted-text)]">Legacy deployment · no platform fee.</p>}
      {!terms.legacy && <p className="mt-1 text-[var(--muted-text)]">{mintSurcharge ? "The collector fee is added to the mint price. The creator fee is deducted from the mint price." : "The platform fee is included in the payment and deducted from proceeds."}</p>}
      {terms.recipient && <p className="mt-1 break-all text-[10px] text-[var(--muted-text)]">Platform fee wallet: {terms.recipient}</p>}
    </>}
    {auction && <p className="mt-1 text-[var(--muted-text)]">Creator royalties are separate. Applicable ERC-2981 royalties are also deducted at settlement; the seller receives the remainder.</p>}
    <p className="mt-1 text-[var(--muted-text)]">Network gas is separate and shown by your wallet before confirmation.</p>
  </div>;
}
