"use client";

import { useState, type FormEvent } from "react";

const button = "gallery-button px-5 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function CreatorMintControls({ deployed, supported, supply, minted, minimumSupply, closed, canClose, busy, onReduce, onClose }: {
  deployed: boolean; supported: boolean; supply: number; minted: number; minimumSupply: number;
  closed: boolean; canClose: boolean; busy: boolean; onReduce: (supply: number) => Promise<void>; onClose: () => Promise<void>;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  async function reduce(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const value = new FormData(event.currentTarget).get("supply");
    const next = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(next) || next < minimumSupply || next >= supply) { setError(`Choose a whole supply from ${minimumSupply} to ${supply - 1}.`); return; }
    try { await onReduce(next); } catch (cause) { setError(cause instanceof Error ? cause.message : "The supply could not be reduced."); }
  }
  return <section className="mt-6 space-y-4 rounded-2xl border border-[var(--border-soft)] p-5" aria-label="Creator mint controls">
    <h2 className="text-sm font-semibold">Creator mint controls</h2>
    {deployed && !supported ? <p className="text-xs leading-6 text-[var(--muted-text)]">This collection uses an earlier contract with fixed supply and mint settings. Supply reduction, whitelist updates and closing minting are available for new collections using the updated mint controls.</p> : <>
      <p className="text-xs leading-6 text-[var(--muted-text)]">{minted} minted out of {supply}. Reducing supply is permanent. Minted NFTs and their metadata stay intact.{minimumSupply > Math.max(1, minted) ? ` At least ${minimumSupply} tokens are needed to preserve guaranteed allocations until FCFS opens.` : ""}</p>
      {!closed && supply > minimumSupply && <form key={`${supply}:${minimumSupply}`} onSubmit={reduce} className="space-y-3">
        <label className="block text-xs font-semibold">New total supply<input name="supply" aria-label="New total supply" type="number" required min={minimumSupply} max={supply - 1} step="1" defaultValue={supply - 1} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /></label>
        <button className={button} disabled={busy}>Reduce collection supply</button>
      </form>}
      {deployed && !closed && !canClose && <p className="text-xs leading-6 text-[var(--muted-text)]">Closing becomes available when public minting opens. Guaranteed and FCFS wallets keep their full mint windows.</p>}
      {deployed && !closed && canClose && (!confirmClose ? <button type="button" className="rounded-full border border-rose-400/40 px-4 py-3 text-xs font-semibold text-rose-600 disabled:opacity-40" disabled={busy} onClick={() => setConfirmClose(true)}>Close minting</button> : <div className="space-y-3 rounded-xl border border-rose-400/30 p-4">
        <p className="text-xs leading-6">Closing ends minting permanently, including any remaining whitelist windows. Existing NFTs and creator withdrawals remain available.</p>
        <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={() => { setError(""); void onClose().catch((cause) => setError(cause instanceof Error ? cause.message : "Minting could not be closed.")); }}>Close minting permanently</button><button type="button" className="text-xs underline" disabled={busy} onClick={() => setConfirmClose(false)}>Keep minting open</button></div>
      </div>)}
      {closed && <p role="status" className="text-xs font-semibold">Minting has been permanently closed by the creator.</p>}
    </>}
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
  </section>;
}
