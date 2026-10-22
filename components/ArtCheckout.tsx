"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { keccak256, toHex, zeroAddress, type Hash } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import ReviewerOnly from "@/components/ReviewerOnly";
import CreatorLink from "@/components/CreatorLink";
import WatchlistButton from "@/components/WatchlistButton";
import ShareItemButton from "@/components/ShareItemButton";
import TransactionStatus from "@/components/TransactionStatus";
import PlatformFeeBreakdown from "@/components/PlatformFeeBreakdown";
import { usePlatformFees } from "@/hooks/usePlatformFees";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { arcChain } from "@/lib/arcConfig";
import { artMarketAbi, artMarketForItem, displayUsdc, protocol, usdcAmount } from "@/lib/protocol";
import { emptyArtDelivery, validateArtDelivery, type ArtDelivery } from "@/lib/artDelivery";

type Art = { id: string; itemType: string; title: string; description: string | null; imageUrl: string | null; priceUsdc: number | null; sold: boolean; artListingId: string | null; artListingSeller: string | null; artMarketAddress?: string | null; creator: { id?: string; username: string | null } };
type Order = { id: string; txHash: string; delivery: ArtDelivery };
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const fields: Array<[keyof ArtDelivery, string, string, boolean, number]> = [
  ["recipient", "Recipient name", "shipping name", true, 100], ["phone", "Phone number", "shipping tel", true, 30],
  ["addressLine1", "Street address", "shipping address-line1", true, 200], ["addressLine2", "Address line 2 (optional)", "shipping address-line2", false, 200],
  ["city", "City", "shipping address-level2", true, 100], ["region", "State or region (optional)", "shipping address-level1", false, 100],
  ["postalCode", "Postal code (optional)", "shipping postal-code", false, 20], ["country", "Country", "shipping country-name", true, 80],
  ["instructions", "Delivery instructions (optional)", "off", false, 500],
];

export default function ArtCheckout({ id }: { id: string }) {
  const tx = useProtocolTransaction(); const account = useArtiqAccount();
  const [delivery, setDelivery] = useState<ArtDelivery>({ ...emptyArtDelivery });
  const [purchaseHash, setPurchaseHash] = useState("");
  const [saving, setSaving] = useState(false);
  const identity = account.identity || "guest";
  useEffect(() => { setDelivery({ ...emptyArtDelivery }); setPurchaseHash(""); }, [id, identity]);
  const path = `/api/items/${encodeURIComponent(id)}`;
  const artQuery = useQuery({ queryKey: ["item-detail", id, identity], queryFn: async (): Promise<{ item: Art; isOwner: boolean }> => {
    const response = await fetch(path, { cache: "no-store", headers: account.headers }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Artwork unavailable."); return data;
  } });
  const orderQuery = useQuery({ queryKey: ["art-order", id, identity], enabled: account.authenticated, retry: false, queryFn: async (): Promise<{ order: Order | null }> => {
    const response = await fetch(`${path}/order`, { cache: "no-store", headers: account.headers }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Delivery details unavailable."); return data;
  } });
  const art = artQuery.data?.item; const owner = artQuery.data?.isOwner;
  const market = artMarketForItem(art || {});
  const fees = usePlatformFees(tx.client, market);
  const chain = useQuery({ queryKey: ["art-checkout", art?.artListingId, market, tx.address], enabled: !!art && !!tx.client && !!market && protocol.isTestnet, refetchInterval: 12_000, queryFn: async () => {
    const [listing, proceeds] = await Promise.all([
      art?.artListingId ? tx.client!.readContract({ address: market!, abi: artMarketAbi, functionName: "listings", args: [BigInt(art.artListingId)] }) : null,
      tx.address ? tx.client!.readContract({ address: market!, abi: artMarketAbi, functionName: "pendingReturns", args: [tx.address] }) : BigInt(0),
    ]);
    if (listing && (listing[1] !== keccak256(toHex(id)) || listing[0].toLowerCase() !== art?.artListingSeller?.toLowerCase())) throw new Error("This listing does not match the approved artwork.");
    return { listing, proceeds };
  } });
  const listing = chain.data?.listing;
  const purchased = !!listing && listing[3] !== zeroAddress;
  const purchasedByWallet = purchased && listing?.[3].toLowerCase() === account.walletAddress?.toLowerCase();
  const seller = !!listing && listing[0].toLowerCase() === tx.address?.toLowerCase();
  const cancelled = listing?.[4] === true;
  const canAct = !!market && protocol.isTestnet && !!account.walletAddress && tx.isConnected && !tx.pending && !tx.isWrongNetwork;
  const refresh = async () => { await chain.refetch(); await tx.refetchBalance(); await artQuery.refetch(); };
  function connect() { if (!account.authenticated) account.login(); else account.connectWallet(); }
  async function saveListing(txHash: Hash) {
    const response = await fetch(`${path}/art-listing`, { method: "POST", headers: { "Content-Type": "application/json", ...account.headers }, body: JSON.stringify({ txHash }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "The listing confirmed but could not be saved. Retry below."); await refresh();
  }
  async function saveOrder(txHash: Hash, address: ArtDelivery) {
    setPurchaseHash(txHash);
    const response = await fetch(`${path}/order`, { method: "POST", headers: { "Content-Type": "application/json", ...account.headers }, body: JSON.stringify({ txHash, delivery: address }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Payment confirmed, but delivery was not saved. Retry saving; do not pay again.");
    await orderQuery.refetch(); await refresh();
  }
  function buy(event: FormEvent) {
    event.preventDefault();
    let address: ArtDelivery;
    try { address = validateArtDelivery(delivery); } catch (error) { tx.setError((error as Error).message); return; }
    if (!account.authenticated || !account.walletAddress) { connect(); return; }
    if (!canAct || !listing || !art?.artListingId || purchased || owner || seller || cancelled) return;
    if (!fees.data || fees.isError) { tx.setError("Wait for the platform fee check before paying."); return; }
    void tx.run((write) => write({ address: market!, abi: artMarketAbi, functionName: "buyListing", args: [BigInt(art.artListingId!)], value: listing[2], chainId: arcChain.id }), async (hash) => { setPurchaseHash(hash); await saveOrder(hash, address); });
  }
  async function retryOrder(event: FormEvent) {
    event.preventDefault(); tx.setError("");
    try {
      const address = validateArtDelivery(delivery);
      if (!/^0x[a-fA-F0-9]{64}$/.test(purchaseHash)) throw new Error("Enter your confirmed purchase transaction hash.");
      setSaving(true); await saveOrder(purchaseHash as Hash, address);
    } catch (error) { tx.setError((error as Error).message); } finally { setSaving(false); }
  }
  const order = orderQuery.data?.order;

  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-8">
    <Link href="/marketplace?mode=art" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-text)]"><ArrowLeft size={14} />ART BAZZAR</Link>
    {artQuery.isLoading ? <p role="status" className="mt-8">Loading artwork…</p> : artQuery.isError || art?.itemType !== "WEB2_ART" ? <div className="gallery-card mt-8 p-8"><h1 className="text-2xl">Artwork unavailable</h1><p className="mt-3 text-sm">{artQuery.error?.message || "Only approved original artwork is shown here."}</p><button type="button" onClick={() => void artQuery.refetch()} className={`${button} mt-4`}>Retry loading artwork</button></div> :
      <div className="mt-7 grid gap-8 lg:grid-cols-2">
        <div className="gallery-card relative aspect-square self-start overflow-hidden">{art.imageUrl && <Image src={art.imageUrl} alt={art.title} fill unoptimized sizes="(min-width:1024px) 50vw,100vw" className="object-cover" />}</div>
        <div><p className="text-xs font-semibold text-[#b55fbe]">Reviewed ART BAZZAR</p><h1 className="mt-5 text-4xl sm:text-5xl">{art.title}</h1><p className="mt-3 text-xs text-[var(--muted-text)]">By <CreatorLink creator={art.creator} /></p><div className="mt-4 flex flex-wrap gap-3"><WatchlistButton itemId={id} /><ShareItemButton title={art.title} /></div><p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{art.description}</p><p className="mt-6 text-3xl">{listing ? displayUsdc(listing[2]) : art.priceUsdc} <span className="text-sm">USDC</span></p>
          <section className="mt-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-5" aria-label="Art checkout">
            <h2 className="text-sm font-semibold">Purchase & delivery</h2><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Pay with Arc Testnet USDC. Your delivery details are shared privately with the creator after payment confirmation. Agree shipping costs and availability with the creator before paying. Delivery is arranged by the creator. Test USDC has no monetary value.</p>
            {market && <PlatformFeeBreakdown terms={fees.data} gross={listing?.[2] ?? (art.priceUsdc != null ? usdcAmount(String(art.priceUsdc), true) : undefined)} isError={fees.isError} onRetry={() => void fees.refetch()} />}
            {!market && <p className="mt-4 text-sm leading-6">Payments are temporarily unavailable. Please check back later. <ReviewerOnly><Link href="/settings/protocol" className="font-semibold text-[#b55fbe] underline">Set up Arc Testnet payments →</Link></ReviewerOnly></p>}
            {market && !art.artListingId && <p className="mt-4 text-xs leading-6">{owner ? "Activate checkout from your linked wallet so collectors can purchase this artwork." : "The creator needs to activate checkout before this artwork can be purchased."}</p>}
            {!account.authenticated || !account.walletAddress || !tx.isConnected ? <button type="button" className={`${button} mt-4`} disabled={!account.ready || tx.pending} onClick={connect}>{!account.authenticated ? "Sign in to purchase" : "Connect a wallet to continue"}</button> : tx.isWrongNetwork ? <button type="button" className={`${button} mt-4`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button> : null}
            {owner && market && !art.artListingId && <button type="button" className={`${button} mt-4`} disabled={!canAct || !fees.data || fees.isError} onClick={() => void tx.run((write) => write({ address: market, abi: artMarketAbi, functionName: "createListing", args: [keccak256(toHex(id)), usdcAmount(String(art.priceUsdc))], chainId: arcChain.id }), saveListing)}>Activate artwork checkout</button>}
            {owner && tx.hash && tx.error && !art.artListingId && <button type="button" className="mt-3 block text-xs font-semibold underline" onClick={() => void saveListing(tx.hash!).catch((error) => tx.setError(error.message))}>Retry saving confirmed listing</button>}
            {chain.isError && <p role="alert" className="mt-4 text-xs text-rose-500">Couldn’t verify this listing. <button type="button" className="underline" onClick={() => void chain.refetch()}>Retry before paying</button></p>}
            {art.artListingId && !listing && !chain.isError && <p role="status" className="mt-4 text-xs">Checking the on-chain listing…</p>}
            {purchased && <p className="mt-4 text-sm font-semibold text-emerald-600 dark:text-emerald-300">{purchasedByWallet ? "Payment confirmed. Do not pay again." : "This artwork has been purchased."}</p>}
            {cancelled && <p className="mt-4 text-sm">Checkout was cancelled by the creator.</p>}
            {owner && listing && !purchased && !cancelled && <p className="mt-4 text-sm">Your artwork is available to collectors.</p>}
            {order ? <div className="mt-5 rounded-xl border border-[var(--border-soft)] p-4"><h3 className="text-sm font-semibold">{owner ? "Buyer delivery details" : "Your delivery address is saved"}</h3><address className="mt-3 whitespace-pre-line text-sm not-italic leading-6">{[order.delivery.recipient, order.delivery.addressLine1, order.delivery.addressLine2, [order.delivery.city, order.delivery.region, order.delivery.postalCode].filter(Boolean).join(", "), order.delivery.country, order.delivery.phone].filter(Boolean).join("\n")}</address>{order.delivery.instructions && <p className="mt-3 text-xs">{order.delivery.instructions}</p>}<p className="mt-3 break-all text-xs text-[var(--muted-text)]">Order {order.id}</p></div> : !owner && !seller && (!purchased || purchasedByWallet) && !cancelled ?
              <form onSubmit={purchasedByWallet || purchaseHash ? retryOrder : buy} className="mt-5 space-y-4"><h3 className="text-sm font-semibold">Delivery address</h3><p className="text-xs leading-6 text-[var(--muted-text)]">Saved after a verified purchase. Only you and the creator can view it.</p>
                {fields.map(([key, label, autoComplete, required, max]) => <label key={key} className="block text-xs font-semibold" htmlFor={`delivery-${key}`}>{label}<input id={`delivery-${key}`} name={key} type={key === "phone" ? "tel" : "text"} autoComplete={autoComplete} required={required} maxLength={max} value={delivery[key]} disabled={tx.pending || saving} onChange={(event) => setDelivery((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm font-normal" /></label>)}
                {(purchasedByWallet || purchaseHash) && <label className="block text-xs font-semibold" htmlFor="purchase-hash">Confirmed purchase transaction hash<input id="purchase-hash" value={purchaseHash} onChange={(event) => setPurchaseHash(event.target.value.trim())} required pattern="0x[a-fA-F0-9]{64}" className="mt-2 block w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 font-mono text-xs" /></label>}
                <button type="submit" className={`${button} w-full`} disabled={purchasedByWallet || purchaseHash ? !account.walletAddress || saving || tx.pending : !canAct || !listing || !fees.data || fees.isError || art.sold || chain.isError || orderQuery.isLoading || orderQuery.isError}>{saving ? "Saving delivery details…" : tx.pending ? "Confirming payment…" : purchasedByWallet || purchaseHash ? "Save delivery details — no new payment" : !market ? "Payments temporarily unavailable" : !art.artListingId ? "Awaiting creator checkout activation" : "Purchase art with test USDC"}</button>
              </form> : null}
            {orderQuery.isError && <p role="alert" className="mt-3 text-xs">Couldn’t load saved delivery details. <button type="button" className="underline" onClick={() => void orderQuery.refetch()}>Retry</button></p>}
            {seller && !purchased && !cancelled && <button type="button" className="mt-4 text-xs font-semibold underline" disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market!, abi: artMarketAbi, functionName: "cancelListing", args: [BigInt(art.artListingId!)], chainId: arcChain.id }), refresh)}>Cancel checkout listing</button>}
            {!!chain.data?.proceeds && <button type="button" className={`${button} mt-4`} disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market!, abi: artMarketAbi, functionName: "withdraw", args: [tx.address!], chainId: arcChain.id }), refresh)}>Withdraw {displayUsdc(chain.data!.proceeds)} USDC proceeds</button>}
          </section><div className="mt-5"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div>
        </div>
      </div>}
  </div></main>;
}
