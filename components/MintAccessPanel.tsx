"use client";

import { useState, type FormEvent } from "react";
import type { Hex } from "viem";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import type { useMintAccess } from "@/hooks/useMintAccess";
import type { MintPhaseConfig } from "@/lib/mintAccess";

const input = "w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm";
const button = "gallery-button px-4 py-2 text-xs font-semibold text-white disabled:opacity-40";
const localDate = (value?: string) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const hour = 60 * 60 * 1000;
const tierLabel = (tier: string) => tier === "ULTIMATE" ? "Guaranteed" : tier === "PENDING" ? "Pending" : "FCFS";

type Props = {
  access: ReturnType<typeof useMintAccess>; isOwner: boolean; deployed: boolean;
  walletCap: number; publicPrice: number; onChange: () => void;
  supportsManagement?: boolean; managementBusy?: boolean;
  deploymentPending?: boolean;
  onPublishAllowlist?: (pending: { root: Hex; guaranteedAllocation: number }) => Promise<void>;
};

export default function MintAccessPanel({ access, isOwner, deployed, walletCap, publicPrice, onChange, supportsManagement = false, managementBusy = false, deploymentPending = false, onPublishAllowlist }: Props) {
  const account = useArtiqAccount();
  const [showSetup, setShowSetup] = useState(false);
  const [wallets, setWallets] = useState("");
  const [tier, setTier] = useState("FCFS");
  const [editingPrice, setEditingPrice] = useState<"ULTIMATE" | "FCFS" | null>(null);
  const [price, setPrice] = useState("");
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [guaranteedPrice, setGuaranteedPrice] = useState<string | null>(null);
  const [fcfsPrice, setFcfsPrice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const plan = access.data?.plan;
  const locked = !!plan?.frozenAt || deployed;
  const started = !!plan && Date.parse(plan.config.ultimateStart) <= Date.now();
  const editableRoster = !!plan && !started && (!locked || (deployed && supportsManagement));
  const pendingUpdate = access.data?.pendingUpdate;
  const entries = pendingUpdate?.entries ?? access.data?.entries;
  const busy = access.saving || managementBusy || publishing;
  const startValue = draftStart ?? localDate(plan?.config.ultimateStart);
  const startMs = startValue ? new Date(startValue).getTime() : NaN;
  const guaranteedValue = guaranteedPrice ?? plan?.config.ultimatePrice ?? String(publicPrice);
  const fcfsValue = fcfsPrice ?? plan?.config.fcfsPrice ?? String(publicPrice);
  const scheduledTime = (offset: number) => Number.isFinite(startMs) ? localDate(new Date(startMs + offset * hour).toISOString()) : "";

  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLocalError(null);
    try {
      const data = new FormData(event.currentTarget);
      const start = new Date(String(data.get("ultimateStart"))).getTime();
      if (!Number.isFinite(start)) throw new Error("Choose a valid mint start time.");
      const config: MintPhaseConfig = {
        ultimateStart: new Date(start).toISOString(), fcfsStart: new Date(start + hour).toISOString(), publicStart: new Date(start + 2 * hour).toISOString(),
        ultimateLimit: Number(data.get("ultimateLimit")), fcfsLimit: Number(data.get("fcfsLimit")), publicLimit: Number(data.get("publicLimit")),
        ultimatePrice: String(data.get("ultimatePrice")), fcfsPrice: String(data.get("fcfsPrice")),
      };
      access.save({ action: "configure", config }, { onSuccess: () => { setShowSetup(false); onChange(); } });
    } catch (error) { setLocalError(error instanceof Error ? error.message : "Could not save phase settings."); }
  }
  function savePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || !editingPrice || busy) return;
    access.save({ action: "price", tier: editingPrice, price }, { onSuccess: () => { setEditingPrice(null); onChange(); } });
  }
  async function publishAllowlist() {
    if (!pendingUpdate || !onPublishAllowlist || busy) return;
    setLocalError(null); setPublishing(true);
    try { await onPublishAllowlist(pendingUpdate); onChange(); }
    catch (error) { setLocalError(error instanceof Error ? error.message : "The whitelist update could not be confirmed. Your saved changes remain available."); }
    finally { setPublishing(false); }
  }

  if (access.isLoading) return <p className="mt-4 text-xs" role="status">Loading mint access…</p>;
  if (access.isError) return <p role="alert" className="mt-4 text-xs text-rose-500">{access.error.message}</p>;
  if (!plan && (!isOwner || deployed)) return null;
  return <section className="mt-6 space-y-4 rounded-2xl border border-[var(--border-soft)] p-5">
    <h2 className="text-lg">Mint access</h2>
    {plan && <>
      <p className="text-xs leading-6 text-[var(--muted-text)]">{deployed && !supportsManagement ? "Guaranteed wallets mint first. The FCFS window follows this collection’s existing access rules, then public minting opens to everyone." : "Only Guaranteed wallets can mint during the first hour. Only FCFS wallets can mint during the next hour. Public minting then opens to everyone and stays open until the creator closes it."} The overall wallet cap is {walletCap}.</p>
      <div className="space-y-2">{([['Guaranteed', 'ultimateStart', 'ultimatePrice', 'ultimateLimit'], ['FCFS', 'fcfsStart', 'fcfsPrice', 'fcfsLimit'], ['Public', 'publicStart', null, 'publicLimit']] as const).map(([label, date, priceKey, limit]) => <div key={label} className="rounded-xl bg-[var(--chip-bg)] p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{label === "Guaranteed" ? "Guaranteed · reserved allocation" : label === "Public" ? "Public · main price" : label}</strong>{isOwner && !locked && priceKey && <button type="button" aria-label={`Edit ${label} price`} disabled={busy} className="font-semibold text-[#b55fbe] underline disabled:opacity-40" onClick={() => { setEditingPrice(label === "Guaranteed" ? "ULTIMATE" : "FCFS"); setPrice(plan.config[priceKey]); setShowSetup(false); }}>Edit price</button>}</div>
        <p className="mt-1">{new Date(plan.config[date]).toLocaleString()}</p><p className="mt-1">{priceKey ? plan.config[priceKey] : publicPrice} USDC · up to {plan.config[limit]} per wallet in this phase</p>{label === "Public" && (!deployed || supportsManagement) && <p className="mt-1 text-[var(--muted-text)]">Open until the creator closes minting.</p>}
      </div>)}</div>
      <p className="text-xs">{plan.registrations} registered wallets{isOwner && access.data?.entries ? ` · ${access.data.entries.filter((entry) => entry.tier === "ULTIMATE").length * plan.config.ultimateLimit} tokens reserved for Guaranteed` : ""} · {locked ? "Whitelist published" : "Registrations open"}</p>
    </>}
    {isOwner && !locked && <>
      <p className="text-xs leading-6 text-[var(--muted-text)]">FCFS and Public prices must each be at least the Guaranteed price. FCFS may cost more than Public. Public uses the collection’s main price of {publicPrice} USDC.</p>
      {plan && editingPrice && <form aria-label={`Edit ${tierLabel(editingPrice)} price`} onSubmit={savePrice} className="space-y-3 rounded-xl border border-[var(--border-soft)] p-4"><label className="block text-xs">{tierLabel(editingPrice)} price in USDC<input aria-label={`${tierLabel(editingPrice)} price in USDC`} className={input} name="price" type="number" inputMode="decimal" required min={editingPrice === "FCFS" ? plan.config.ultimatePrice : "0"} max={editingPrice === "ULTIMATE" ? Math.min(publicPrice, Number(plan.config.fcfsPrice)) : 1000000} step="0.000001" disabled={busy} value={price} onChange={(event) => setPrice(event.target.value)} /></label><div className="flex flex-wrap gap-3"><button className={button} disabled={busy}>Save {tierLabel(editingPrice)} price</button><button type="button" className="text-xs underline" disabled={busy} onClick={() => setEditingPrice(null)}>Cancel</button></div></form>}
      <button type="button" className={button} disabled={busy} onClick={() => { setShowSetup(!showSetup); setEditingPrice(null); setDraftStart(null); setGuaranteedPrice(null); setFcfsPrice(null); }}>{showSetup ? "Cancel phase settings" : plan ? "Edit phase settings" : "Set up allowlist phases"}</button>
      {showSetup && <form onSubmit={configure} className="space-y-3" key={JSON.stringify(plan?.config)} aria-label="Mint phase settings">
        <label className="block text-xs">Mint starts · your local time<input aria-label="Guaranteed opens" className={input} name="ultimateStart" type="datetime-local" required value={startValue} onChange={(event) => setDraftStart(event.target.value)} /></label><p className="text-xs leading-6 text-[var(--muted-text)]">Guaranteed opens at your start time. FCFS opens one hour later, and Public opens two hours later.</p>
        {([['ultimate', 'Guaranteed'], ['fcfs', 'FCFS'], ['public', 'Public']] as const).map(([key, label]) => <fieldset className="space-y-2" key={key}><legend className="mb-2 text-sm font-semibold">{label}</legend>{key !== "ultimate" && <label className="block text-xs">Opens automatically<input aria-label={`${label} opens`} className={input} name={`${key}Start`} type="datetime-local" readOnly value={scheduledTime(key === "fcfs" ? 1 : 2)} /></label>}<label className="block text-xs">Phase wallet limit<input className={input} name={`${key}Limit`} type="number" required min="1" max={walletCap} defaultValue={plan?.config[`${key}Limit`] ?? walletCap} /></label>{key === "public" ? <label className="block text-xs">Public price in USDC<input aria-label="Public price in USDC" className={input} type="number" value={publicPrice} readOnly /><span className="mt-1 block text-[var(--muted-text)]">Uses the main price submitted for this collection.</span></label> : <label className="block text-xs">{label} price in USDC<input aria-label={`${label} price in USDC`} className={input} name={`${key}Price`} type="number" inputMode="decimal" required min={key === "fcfs" ? guaranteedValue : "0"} step="0.000001" max={key === "ultimate" ? Math.min(publicPrice, Number(fcfsValue)) : 1000000} value={key === "ultimate" ? guaranteedValue : fcfsValue} onChange={(event) => key === "ultimate" ? setGuaranteedPrice(event.target.value) : setFcfsPrice(event.target.value)} /></label>}</fieldset>)}
        <button className={button} disabled={busy}>Save phase settings</button>
      </form>}
    </>}
    {isOwner && editableRoster && <div className="space-y-3">
      <h3 className="text-sm font-semibold">{deployed ? "Update whitelist wallets" : "Whitelist wallets"}</h3><p className="text-xs leading-6 text-[var(--muted-text)]">Add wallet addresses directly to Guaranteed or FCFS. {deployed ? "Save your changes, then publish the update with the creator wallet before Guaranteed minting starts. The current whitelist stays active until the update is confirmed." : "Each wallet belongs to one tier. Pending wallets cannot mint before Public opens."}</p>
      <label className="block text-xs">Paste wallets, or import a text/CSV file<input type="file" accept=".txt,.csv" disabled={busy} className="mt-2 block text-xs" onChange={async (event) => { const file = event.target.files?.[0]; if (file && file.size <= 150000) setWallets(await file.text()); else if (file) setLocalError("Choose a wallet file no larger than 150 KB."); }} /><textarea aria-label="Whitelist wallet addresses" className={`${input} mt-2`} rows={3} value={wallets} disabled={busy} onChange={(event) => setWallets(event.target.value)} placeholder="0x… (one address per line or comma-separated)" /></label>
      <label className="block text-xs">Assign tier<select aria-label="Assign whitelist tier" className={input} value={tier} disabled={busy} onChange={(event) => setTier(event.target.value)}><option value="ULTIMATE">Guaranteed</option><option value="FCFS">FCFS</option><option value="PENDING">Pending / no allowlist access</option></select></label><button type="button" className={button} disabled={busy || !wallets.trim()} onClick={() => access.save({ action: "assign", tier, wallets: wallets.split(/[\s,;]+/).filter(Boolean) }, { onSuccess: () => setWallets("") })}>{deployed ? "Save whitelist changes" : "Assign wallets"}</button>
      <div className="max-h-64 space-y-2 overflow-auto">{entries?.map((entry) => <div key={entry.walletAddress} className="rounded-xl bg-[var(--chip-bg)] p-3"><p className="break-all text-[11px]">{entry.walletAddress}</p><p className="my-2 text-[11px]">Requested {tierLabel(entry.requestedTier)}</p><select aria-label={`Tier for ${entry.walletAddress}`} className={input} value={entry.tier} disabled={busy} onChange={(event) => access.save({ action: "assign", wallets: [entry.walletAddress], tier: event.target.value })}><option value="PENDING">Pending</option><option value="ULTIMATE">Guaranteed</option><option value="FCFS">FCFS</option></select></div>)}</div>
    </div>}
    {isOwner && deployed && supportsManagement && pendingUpdate && <div className="space-y-3 rounded-xl border border-[#b55fbe]/30 p-4"><p className="text-xs leading-6">Unpublished whitelist changes · {pendingUpdate.entries.filter((entry) => entry.tier !== "PENDING").length} selected wallets · {pendingUpdate.guaranteedAllocation} Guaranteed tokens reserved.</p><button type="button" className={button} disabled={busy || started || !onPublishAllowlist} onClick={() => void publishAllowlist()}>{publishing ? "Publishing whitelist…" : "Publish whitelist update"}</button><button type="button" className="ml-3 text-xs underline" disabled={busy} onClick={() => access.save({ action: "discard-allowlist" })}>Discard whitelist changes</button>{started && <p className="text-xs leading-6 text-[var(--muted-text)]">New whitelist updates have closed. If you already confirmed the update in your wallet, verify its saved transaction below.</p>}</div>}
    {isOwner && plan && !locked && <>
      <p className="text-xs leading-6 text-[var(--muted-text)]">Lock the schedule and prices before creating your collection. On collections with whitelist management, you can still add or reassign wallets after creation until Guaranteed minting starts.</p>{(editingPrice || showSetup) && <p className="mb-2 text-xs text-[var(--muted-text)]">Save or cancel your changes before locking the allowlist.</p>}<button type="button" className={button} disabled={busy || editingPrice !== null || showSetup} onClick={() => access.save({ action: "freeze" }, { onSuccess: onChange })}>Lock allowlist for deployment</button><button type="button" className="ml-3 text-xs underline" disabled={busy} onClick={() => access.save({ action: "disable" }, { onSuccess: () => { setEditingPrice(null); setShowSetup(false); onChange(); } })}>Return to public-only mint</button>
    </>}
    {!isOwner && plan && <><p className="text-xs">{access.data?.entry ? `Your tier: ${access.data.entry.tier === "PENDING" ? "Awaiting creator approval" : tierLabel(access.data.entry.tier)}` : locked ? "You are not on the whitelist. You can mint during public access." : "Request access with your connected wallet. The creator assigns the final tier."}</p>{!locked && !started && <div className="flex flex-wrap gap-2">{["ULTIMATE", "FCFS"].map((requested) => <button key={requested} type="button" className={button} disabled={busy} onClick={() => { if (!account.authenticated) account.login(); else if (!account.walletAddress) account.connectWallet(); else access.save({ action: "register", tier: requested }); }}>Request {tierLabel(requested)}</button>)}</div>}</>}
    {isOwner && locked && !deployed && <div className="space-y-3 rounded-xl border border-[var(--border-soft)] p-4">
      {!confirmUnlock ? <button type="button" className="text-xs font-semibold underline disabled:opacity-40" disabled={busy || deploymentPending} onClick={() => setConfirmUnlock(true)}>Unlock setup</button> : <>
        <p className="text-xs leading-6 text-[var(--muted-text)]">Unlock only if you have not submitted a collection creation transaction. Recover a submitted transaction first. Unlocking lets you change the schedule, prices and wallet list, then lock them again before creation.</p>
        <button type="button" className={button} disabled={busy || deploymentPending} onClick={() => access.save({ action: "unfreeze" }, { onSuccess: () => { setConfirmUnlock(false); onChange(); } })}>Unlock schedule and whitelist</button><button type="button" className="ml-3 text-xs underline" disabled={busy} onClick={() => setConfirmUnlock(false)}>Keep setup locked</button>
      </>}
      {deploymentPending && <p className="text-xs leading-6 text-[var(--muted-text)]">Verify your saved creation transaction before changing this setup.</p>}
    </div>}
    {isOwner && locked && <p className="text-xs leading-6 text-[var(--muted-text)]">{!deployed ? "The schedule and whitelist are locked for creation. Unlock setup if you need to choose a new start time before submitting a creation transaction." : started ? "Minting has started, so whitelist wallets are final. Guaranteed reservations last until FCFS opens." : supportsManagement ? "Wallet changes are available until Guaranteed minting starts. The schedule and prices remain fixed." : "This collection’s whitelist is fixed. Wallet updates are available on newly created collections with whitelist management."}</p>}
    {(localError || access.saveError) && <p role="alert" className="text-xs text-rose-500">{localError || access.saveError}</p>}
  </section>;
}
