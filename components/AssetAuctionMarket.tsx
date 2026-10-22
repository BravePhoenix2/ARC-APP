"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Clock3, Gavel, ImagePlus, Package, Plus, Radio, Search, ShieldCheck, X } from "lucide-react";
import { formatUnits, zeroAddress, type Address, type Hash } from "viem";
import ReviewerOnly from "@/components/ReviewerOnly";
import PlatformFeeBreakdown from "@/components/PlatformFeeBreakdown";
import TransactionStatus from "@/components/TransactionStatus";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { usePlatformFees } from "@/hooks/usePlatformFees";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import type { PlatformFeeTerms } from "@/lib/platformFeeRead";
import { arcChain } from "@/lib/arcConfig";
import { auctionAbi, displayUsdc, minimumUsdcBid, protocol, transactionError, usdcAmount } from "@/lib/protocol";
import { emptyArtDelivery, validateArtDelivery, type ArtDelivery } from "@/lib/artDelivery";
import { assertAssetBid, assetAuctionNow, pendingAssetAuctionKey, readPendingAssetAuctions, verifiedAssetAuction, type AssetAuctionState, type PendingAssetAuction } from "@/lib/assetAuctionClient";
import type { AssetAuctionDTO, AssetAuctionKind } from "@/lib/assetAuctions";

type Transaction = ReturnType<typeof useProtocolTransaction>;
type Account = ReturnType<typeof useArtiqAccount>;
type Verified = { auction?: AssetAuctionState; error?: string };
type Listings = { auctions: AssetAuctionDTO[]; hasMore: boolean };
type Fulfillment = { kind: AssetAuctionKind; settled: boolean; winnerWallet: string | null; digitalDeliveryUrl?: string | null; delivery: ArtDelivery | null; needsDelivery: boolean };
const input = "w-full min-w-0 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm outline-none focus:border-[#b55fbe]";
const button = "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2.5 text-xs font-semibold transition hover:bg-[var(--chip-bg)] disabled:cursor-not-allowed disabled:opacity-40";
const primary = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const matches = (first: string | undefined, second: string | undefined | null) => !!first && !!second && first.toLowerCase() === second.toLowerCase();
const rawUsdc = (value: bigint) => formatUnits(value, 18);
function enteredUsdc(value: string): bigint | undefined { try { return value ? usdcAmount(value) : undefined; } catch { return undefined; } }
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "The request could not be completed. Please try again.");
  return body as T;
}

export function AssetCountdown({ ends, now }: { ends: number; now: number }) {
  const left = Math.max(0, ends - now);
  return <span className="inline-flex items-center gap-1.5 font-mono text-xs" aria-label="Auction countdown"><Clock3 size={13} />{!now ? "Syncing timer…" : left === 0 ? "Bidding ended" : `${Math.floor(left / 86400)}d ${Math.floor(left % 86400 / 3600)}h ${Math.floor(left % 3600 / 60)}m ${left % 60}s`}</span>;
}

function AuctionDelivery({ listing, account, winner }: { listing: AssetAuctionDTO; account: Account; winner: boolean }) {
  const [delivery, setDelivery] = useState<ArtDelivery>({ ...emptyArtDelivery });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const path = `/api/asset-auctions/${encodeURIComponent(listing.id)}/fulfillment`;
  const details = useQuery({ queryKey: ["asset-auction-fulfillment", listing.id, account.identity, account.walletAddress], enabled: account.authenticated && !!account.walletAddress, retry: false, queryFn: () => request<Fulfillment>(path, { headers: account.headers }) });
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const address = validateArtDelivery(delivery); setSaving(true);
      await request(path, { method: "POST", headers: { ...account.headers, "Content-Type": "application/json" }, body: JSON.stringify({ delivery: address }) });
      await details.refetch();
    } catch (cause) { setError(transactionError(cause)); } finally { setSaving(false); }
  }
  return <div className="mt-4 rounded-xl border border-[var(--border-soft)] p-4">
    <h4 className="text-xs font-semibold">{winner ? "Your winning asset" : "Buyer delivery"}</h4>
    {details.isLoading && <p role="status" className="mt-2 text-xs">Loading private delivery details…</p>}
    {details.isError && <p role="alert" className="mt-2 text-xs">{details.error.message} <button type="button" className="underline" onClick={() => void details.refetch()}>Retry</button></p>}
    {winner && details.data?.digitalDeliveryUrl && <a href={details.data.digitalDeliveryUrl} target="_blank" rel="noreferrer" className={`${button} mt-3`}>Access digital asset <ArrowUpRight size={14} /></a>}
    {details.data?.kind === "DIGITAL" && !winner && <p className="mt-2 text-xs leading-5 text-[var(--muted-text)]">The winning wallet can access the private digital delivery link.</p>}
    {details.data?.delivery && <><p className="mt-3 text-xs font-semibold">{winner ? "Your delivery details are saved" : "Winner’s private delivery details"}</p><address className="mt-2 whitespace-pre-line text-xs not-italic leading-6">{[details.data.delivery.recipient, details.data.delivery.addressLine1, details.data.delivery.addressLine2, [details.data.delivery.city, details.data.delivery.region, details.data.delivery.postalCode].filter(Boolean).join(", "), details.data.delivery.country, details.data.delivery.phone, details.data.delivery.instructions].filter(Boolean).join("\n")}</address></>}
    {details.data?.kind === "PHYSICAL" && !details.data.delivery && !winner && <p className="mt-2 text-xs leading-5 text-[var(--muted-text)]">Waiting for the winner to share their delivery address.</p>}
    {details.data?.needsDelivery && winner && <form onSubmit={save} className="mt-3 space-y-3"><p className="text-xs leading-5 text-[var(--muted-text)]">Shared privately with the seller to arrange delivery. No additional payment.</p>
      {([ ["recipient", "Recipient name", true], ["phone", "Phone number", true], ["addressLine1", "Street address", true], ["addressLine2", "Address line 2", false], ["city", "City", true], ["region", "State or region", false], ["postalCode", "Postal code", false], ["country", "Country", true], ["instructions", "Delivery instructions", false] ] as Array<[keyof ArtDelivery, string, boolean]>).map(([key, label, required]) => <label key={key} className="block text-[11px] font-semibold" htmlFor={`asset-delivery-${listing.id}-${key}`}>{label}{!required && " (optional)"}<input id={`asset-delivery-${listing.id}-${key}`} className={`${input} mt-1 text-xs`} value={delivery[key]} type={key === "phone" ? "tel" : "text"} maxLength={key === "instructions" ? 500 : key === "phone" ? 30 : key === "postalCode" ? 20 : 200} required={required} disabled={saving} onChange={(event) => setDelivery((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
      <button className={`${button} w-full`} disabled={saving}>{saving ? "Saving…" : "Save private delivery details"}</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
  </div>;
}

function AssetCard({ listing, state, now, tx, account, refresh }: { listing: AssetAuctionDTO; state: Verified | undefined; now: number; tx: Transaction; account: Account; refresh: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const market = listing.marketAddress as Address;
  const fees = usePlatformFees(tx.client, market);
  const auction = state?.auction;
  const seller = matches(listing.sellerWallet, tx.address);
  const winner = matches(auction?.bidder, account.walletAddress);
  const ended = !!auction && !!now && now >= auction.ends;
  const canAct = !!account.walletAddress && tx.isConnected && !tx.isWrongNetwork && !tx.pending && protocol.isTestnet;
  const minimum = auction ? minimumUsdcBid(auction.bid, auction.reserve) : undefined;
  function bid() {
    if (!auction) return;
    void tx.run(async (write) => {
      if (!fees.data || fees.isError) throw new Error("Wait for the platform fee check before bidding.");
      const payment = usdcAmount(value || rawUsdc(minimum!));
      const [block, fresh, asset] = await Promise.all([
        tx.client!.getBlock(),
        tx.client!.readContract({ address: market, abi: auctionAbi, functionName: "auctions", args: [auction.id] }),
        tx.client!.readContract({ address: market, abi: auctionAbi, functionName: "auctionAssets", args: [auction.id] }),
      ]);
      const verified = verifiedAssetAuction(listing, fresh, asset, [protocol.auctions, ...(protocol.legacyAuctions || [])]);
      assertAssetBid(verified, payment, Math.max(Number(block.timestamp), now), tx.address!);
      return write({ address: market, abi: auctionAbi, functionName: "bid", args: [auction.id], value: payment, chainId: arcChain.id });
    }, refresh);
  }
  return <article className="gallery-card flex min-w-0 flex-col overflow-hidden" aria-label={`Auction: ${listing.title}`}>
    <div className="relative aspect-[4/3] overflow-hidden bg-[var(--chip-bg)]"><Image src={listing.imageUrl} alt={listing.title} fill unoptimized sizes="(min-width:1280px) 33vw,(min-width:768px) 50vw,100vw" className="object-cover transition duration-500 hover:scale-105" /><span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur">{listing.kind === "PHYSICAL" ? <Package size={12} /> : <ImagePlus size={12} />}{listing.kind === "PHYSICAL" ? "Physical asset" : "Digital asset"}</span><span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-semibold text-white backdrop-blur">{auction?.settled ? auction.bid > BigInt(0) ? "Sold · settled" : "Closed · no sale" : ended ? "Bidding ended" : "Live auction"}</span></div>
    <div className="flex flex-1 flex-col p-5"><div className="flex items-start justify-between gap-2"><h3 className="text-xl leading-tight">{listing.title}</h3><Gavel size={17} className="mt-1 shrink-0 text-[#b55fbe]" /></div><p className="mt-2 text-[11px] text-[var(--muted-text)]">By {listing.seller.username || short(listing.sellerWallet)}{seller && " · Your auction"}</p><p className="mt-3 line-clamp-3 text-xs leading-6 text-[var(--muted-text)]">{listing.description}</p>
      <div className="my-4 flex flex-wrap items-end justify-between gap-3 border-y border-[var(--border-soft)] py-4"><div><p className="text-[10px] text-[var(--muted-text)]">{auction?.bid ? auction.settled ? "Winning bid" : "Highest bid" : "Starting bid"}</p><p className="mt-1 text-xl font-semibold">{auction ? displayUsdc(auction.bid || auction.reserve) : listing.reservePrice}<span className="ml-1 text-xs font-normal">USDC</span></p></div><AssetCountdown ends={auction?.ends ?? Math.floor(new Date(listing.endsAt).getTime() / 1000)} now={now} /></div>
      {auction?.bidder && auction.bidder !== zeroAddress && <p className="mb-3 text-[11px] text-[var(--muted-text)]">{auction.settled ? "Winner" : "Highest bidder"}: <a className="underline" href={`${arcChain.blockExplorers?.default.url}/address/${auction.bidder}`} target="_blank" rel="noreferrer">{short(auction.bidder)}</a>{winner && " (you)"}</p>}
      <details className="mb-3 text-xs"><summary className="cursor-pointer font-semibold">Delivery & asset terms</summary><p className="mt-2 whitespace-pre-wrap leading-6 text-[var(--muted-text)]">{listing.deliveryTerms}</p><p className="mt-2 leading-5 text-[var(--muted-text)]">{listing.kind === "DIGITAL" ? "The settled winner receives a private digital delivery link. This listing does not mint or transfer an NFT." : "The seller arranges physical delivery. Confirm location, shipping costs and availability before bidding."} Payment is released at auction settlement; delivery is not guaranteed by the contract.</p></details>
      {state?.error && <p role="alert" className="mt-2 rounded-xl bg-rose-500/5 p-3 text-xs text-rose-500">{state.error}</p>}
      {!state && <p role="status" className="my-3 text-xs text-[var(--muted-text)]">Verifying this auction on Arc…</p>}
      {auction && <PlatformFeeBreakdown terms={fees.data} gross={!auction.settled && !ended ? enteredUsdc(value) ?? minimum : auction.bid || auction.reserve} isError={fees.isError} onRetry={() => void fees.refetch()} proceedsLabel="Seller receives" totalLabel={!auction.settled && !ended ? "Your bid payment" : auction.bid ? "Winning payment" : "Starting bid"} />}
      {auction && !auction.settled && !ended && <div className="mt-auto"><label htmlFor={`asset-bid-${listing.id}`} className="block text-[11px] font-semibold">Your bid · minimum {displayUsdc(minimum!)} USDC<input id={`asset-bid-${listing.id}`} className={`${input} mt-2`} type="number" min={rawUsdc(minimum!)} max="1000000" step="0.000001" value={value} placeholder={rawUsdc(minimum!)} disabled={tx.pending || seller} onChange={(event) => setValue(event.target.value)} /></label><button type="button" className={`${primary} mt-3 w-full`} disabled={!canAct || seller || !now || !fees.data || fees.isError} onClick={bid}>{seller ? "You own this auction" : "Place bid"}</button>{seller && auction.bid === BigInt(0) && <button type="button" className={`${button} mt-2 w-full`} disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market, abi: auctionAbi, functionName: "cancelAuction", args: [auction.id], chainId: arcChain.id }), refresh)}>Cancel auction</button>}</div>}
      {auction && ended && !auction.settled && <><button type="button" className={`${primary} mt-auto w-full`} disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market, abi: auctionAbi, functionName: "settle", args: [auction.id], chainId: arcChain.id }), refresh)}>Settle auction</button><p className="mt-2 text-[10px] leading-5 text-[var(--muted-text)]">Bidding is closed. Anyone can confirm settlement to release the payment and record the winner.</p></>}
      {auction?.settled && auction.bid > BigInt(0) && account.authenticated && account.walletAddress && (seller || winner) && <AuctionDelivery key={`${account.identity}:${account.walletAddress}`} listing={listing} account={account} winner={winner} />}
      <p className="mt-4 text-[10px] leading-5 text-[var(--muted-text)]">Auction #{listing.auctionId} · Arc Testnet. Outbid payments can be withdrawn in full.</p>
    </div>
  </article>;
}

function DraftAuctionRecovery({ id, draft, saved, tx, now, canAct, registering, onPublish, onActivate }: {
  id: string; draft?: AssetAuctionDTO; saved?: PendingAssetAuction; tx: Transaction; now: number; canAct: boolean; registering: boolean;
  onPublish: (draft: AssetAuctionDTO, terms: PlatformFeeTerms) => Promise<void>;
  onActivate: (listing: Pick<AssetAuctionDTO, "id">, hash: string) => Promise<void>;
}) {
  const [hash, setHash] = useState("");
  const fees = usePlatformFees(tx.client, (draft?.marketAddress || saved?.marketAddress || null) as Address | null);
  return <div className="mt-4 border-t border-[var(--border-soft)] pt-4"><p className="text-xs font-semibold">{draft?.title || "Auction awaiting registration"}</p>
    {saved ? <><p className="mt-2 break-all font-mono text-[10px] text-[var(--muted-text)]">{saved.txHash}</p><button type="button" className={`${button} mt-3`} disabled={registering || tx.pending} onClick={() => void onActivate({ id }, saved.txHash)}>Retry confirmed registration</button></> : draft && <>
      <PlatformFeeBreakdown terms={fees.data} gross={usdcAmount(draft.reservePrice)} isError={fees.isError} onRetry={() => void fees.refetch()} proceedsLabel="Seller receives" totalLabel="Saved starting bid" />
      <div className="mt-3 flex flex-wrap items-end gap-3"><button type="button" className={button} disabled={!canAct || registering || !fees.data || fees.isError || new Date(draft.endsAt).getTime() / 1000 < now + 60} onClick={() => { if (fees.data) void onPublish(draft, fees.data); }}>Confirm saved draft in wallet</button><label className="min-w-0 flex-1 text-[10px] font-semibold">Already confirmed? Creation transaction hash<input className={`${input} mt-1 font-mono text-xs`} value={hash} placeholder="0x…" onChange={(event) => setHash(event.target.value.trim())} /></label><button type="button" className={button} disabled={!hash || registering || tx.pending} onClick={() => void onActivate(draft, hash)}>Register existing transaction</button></div>
    </>}
  </div>;
}

export default function AssetAuctionMarket() {
  const tx = useProtocolTransaction();
  const account = useArtiqAccount();
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<AssetAuctionKind>("DIGITAL");
  const [filter, setFilter] = useState<"ALL" | "DIGITAL" | "PHYSICAL" | "LIVE" | "ENDED">("ALL");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState(1);
  const [wallTime, setWallTime] = useState(0);
  const [reserve, setReserve] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [pendingByKey, setPendingByKey] = useState<Record<string, PendingAssetAuction[]>>({});
  const marketAddress = protocol.auctions;
  const fees = usePlatformFees(tx.client, marketAddress);
  const wallet = account.walletAddress;
  const storageKey = account.identity && wallet ? pendingAssetAuctionKey(account.identity, wallet) : null;
  const pending = storageKey ? pendingByKey[storageKey] || [] : [];
  useEffect(() => { setWallTime(performance.now()); const timer = setInterval(() => setWallTime(performance.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    setImageUrl("");
    if (!storageKey || !wallet) return;
    let entries: PendingAssetAuction[] = [];
    try { entries = readPendingAssetAuctions(localStorage.getItem(storageKey), wallet, arcChain.id); } catch { /* Private drafts can still be recovered from the server. */ }
    setPendingByKey((current) => ({ ...current, [storageKey]: entries }));
  }, [storageKey, wallet]);
  function remember(entries: PendingAssetAuction[]) {
    if (!storageKey) return;
    setPendingByKey((current) => ({ ...current, [storageKey]: entries }));
    try { localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Server drafts remain available if storage is unavailable. */ }
  }
  const listings = useQuery({ queryKey: ["asset-auctions", pages], refetchInterval: 5_000, queryFn: async () => {
    const results = await Promise.all(Array.from({ length: pages }, (_, index) => request<Listings>(`/api/asset-auctions?page=${index + 1}`)));
    return { auctions: results.flatMap((result) => result.auctions), hasMore: results[results.length - 1].hasMore };
  } });
  const mine = useQuery({ queryKey: ["asset-auctions-mine", account.identity, wallet], enabled: account.authenticated && !!wallet, refetchInterval: 15_000, queryFn: () => request<Listings>("/api/asset-auctions?mine=1", { headers: account.headers }) });
  const capability = useQuery({ queryKey: ["asset-auctions-supported", marketAddress], enabled: !!tx.client && !!marketAddress && protocol.isTestnet, retry: false, queryFn: async () => tx.client!.readContract({ address: marketAddress!, abi: auctionAbi, functionName: "supportsAssetAuctions" }).catch(() => false) });
  const assets = listings.data?.auctions || [];
  const houses = [marketAddress, ...(protocol.legacyAuctions || [])];
  const markets = Array.from(new Set(houses.filter((value): value is Address => !!value)));
  const chain = useQuery({ queryKey: ["asset-auctions-chain", assets.map((asset) => `${asset.id}:${asset.auctionId}`).join(","), wallet, markets.join(",")], enabled: !!tx.client && protocol.isTestnet, refetchInterval: 5_000, queryFn: async () => {
    const block = await tx.client!.getBlock();
    const [records, balances] = await Promise.all([
      Promise.all(assets.map(async (asset): Promise<[string, Verified]> => {
        try {
          if (asset.chainId !== arcChain.id || !asset.auctionId || !markets.some((market) => matches(market, asset.marketAddress))) throw new Error("This auction is not activated on a supported Arc Testnet contract.");
          const [auction, details] = await Promise.all([
            tx.client!.readContract({ address: asset.marketAddress as Address, abi: auctionAbi, functionName: "auctions", args: [BigInt(asset.auctionId)] }),
            tx.client!.readContract({ address: asset.marketAddress as Address, abi: auctionAbi, functionName: "auctionAssets", args: [BigInt(asset.auctionId)] }),
          ]);
          return [asset.id, { auction: verifiedAssetAuction(asset, auction, details, houses) }];
        } catch (cause) { return [asset.id, { error: transactionError(cause) }]; }
      })),
      Promise.all(markets.map(async (address) => {
        try { return { address, amount: wallet ? await tx.client!.readContract({ address, abi: auctionAbi, functionName: "pendingReturns", args: [wallet as Address] }) : BigInt(0), error: "" }; }
        catch { return { address, amount: BigInt(0), error: "Your withdrawable balance could not be checked." }; }
      })),
    ]);
    return { records: Object.fromEntries(records), balances, timestamp: Number(block.timestamp), observedAt: performance.now() };
  } });
  const now = assetAuctionNow(chain.data, wallTime);
  const canAct = !!wallet && tx.isConnected && !tx.isWrongNetwork && !tx.pending && protocol.isTestnet;
  const drafts = mine.data?.auctions.filter((listing) => !listing.auctionId && matches(listing.sellerWallet, wallet)) || [];
  const shown = assets.filter((asset) => {
    const auction = chain.data?.records[asset.id]?.auction;
    const ended = auction ? auction.settled || (!!now && now >= auction.ends) : !!now && now >= new Date(asset.endsAt).getTime() / 1000;
    return (filter === "ALL" || asset.kind === filter || filter === "LIVE" && !ended || filter === "ENDED" && ended)
      && (!search.trim() || `${asset.title} ${asset.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  });
  const liveCount = assets.filter((asset) => { const auction = chain.data?.records[asset.id]?.auction; return auction && !auction.settled && now > 0 && now < auction.ends; }).length;
  function connect() { if (!account.authenticated) account.login(); else account.connectWallet(); }
  async function refresh() { await Promise.all([listings.refetch(), mine.refetch(), chain.refetch(), tx.refetchBalance()]); }
  async function activate(listing: Pick<AssetAuctionDTO, "id">, hash: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error("Enter the confirmed auction creation transaction hash.");
    await request(`/api/asset-auctions/${encodeURIComponent(listing.id)}/activate`, { method: "POST", headers: { ...account.headers, "Content-Type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
    remember(pending.filter((entry) => entry.id !== listing.id));
    setShowForm(false); setImageUrl(""); await refresh();
  }
  async function retryActivation(listing: Pick<AssetAuctionDTO, "id">, hash: string) {
    setRegistering(true); tx.setError("");
    try { await activate(listing, hash); } catch (cause) { tx.setError(`${transactionError(cause)} Retry registration after confirmation; no new auction payment is needed.`); } finally { setRegistering(false); }
  }
  async function publish(listing: AssetAuctionDTO, terms: PlatformFeeTerms) {
    if (!canAct || preparing || registering) return;
    if (!matches(listing.sellerWallet, wallet)) { tx.setError("Select the linked wallet that owns this draft before confirming it."); return; }
    const originalMarket = listing.marketAddress as Address;
    void tx.run(async (write) => {
      const supported = await tx.client!.readContract({ address: originalMarket, abi: auctionAbi, functionName: "supportsAssetAuctions" }).catch(() => false);
      if (!supported) throw new Error("This auction contract needs an update before it can accept digital or physical assets.");
      if (!terms) throw new Error("Wait for the platform fee check before creating an auction.");
      const existing = await tx.client!.readContract({ address: originalMarket, abi: auctionAbi, functionName: "assetAuctionIds", args: [listing.sellerWallet as Address, listing.assetKey as Hash] });
      if (existing > BigInt(0)) throw new Error("This draft already exists on-chain. Register its creation transaction below; do not create it again.");
      const hash = await write({ address: originalMarket, abi: auctionAbi, functionName: "createAssetAuction", args: [listing.assetKey as Hash, listing.kind === "DIGITAL" ? 1 : 2, usdcAmount(listing.reservePrice), BigInt(Math.floor(new Date(listing.endsAt).getTime() / 1000))], chainId: arcChain.id });
      remember([...pending.filter((entry) => entry.id !== listing.id), { id: listing.id, txHash: hash, marketAddress: originalMarket, sellerWallet: listing.sellerWallet as Address, chainId: arcChain.id }]);
      return hash;
    }, async (hash) => { await activate(listing, hash); });
  }
  async function createAuction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); tx.setError("");
    if (!canAct || !capability.data || !fees.data || fees.isError) return;
    const fields = new FormData(event.currentTarget);
    try {
      if (!imageUrl) throw new Error("Upload an image of the asset first.");
      const ends = new Date(String(fields.get("ends")));
      const endSeconds = Math.floor(ends.getTime() / 1000);
      if (!now || !Number.isFinite(endSeconds) || endSeconds < now + 120 || endSeconds > now + 30 * 86400) throw new Error("Choose an end time between two minutes and 30 days from now.");
      usdcAmount(reserve); setPreparing(true);
      const result = await request<{ auction: AssetAuctionDTO }>("/api/asset-auctions", { method: "POST", headers: { ...account.headers, "Content-Type": "application/json" }, body: JSON.stringify({ kind, title: String(fields.get("title")), description: String(fields.get("description")), imageUrl, reservePrice: reserve, endsAt: ends.toISOString(), deliveryTerms: String(fields.get("deliveryTerms")), ...(kind === "DIGITAL" ? { digitalDeliveryUrl: String(fields.get("digitalDeliveryUrl")) } : {}) }) });
      await mine.refetch(); setPreparing(false); await publish(result.auction, fees.data);
    } catch (cause) { tx.setError(transactionError(cause)); } finally { setPreparing(false); }
  }
  async function upload(file: File | undefined) {
    if (!file) return; setUploading(true); tx.setError("");
    try { const body = new FormData(); body.append("file", file); const result = await request<{ url: string }>("/api/uploads", { method: "POST", headers: account.headers, body }); setImageUrl(result.url); } catch (cause) { tx.setError(transactionError(cause)); } finally { setUploading(false); }
  }

  return <section id="asset-auctions" aria-label="Digital and physical asset auctions" className="mb-14">
    <div className="relative overflow-hidden rounded-[2rem] border border-[var(--border-soft)] bg-[var(--glass-bg)] px-6 py-9 sm:px-9 sm:py-11"><div className="pointer-events-none absolute -right-10 -top-16 h-64 w-64 rounded-full bg-[#b55fbe]/10 blur-3xl" /><div className="relative flex flex-wrap items-start justify-between gap-7"><div className="max-w-2xl"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b55fbe]"><Radio size={14} />The auction room</p><h1 className="mt-4 text-3xl leading-tight sm:text-5xl">Digital finds.<br />Physical treasures.</h1><p className="mt-4 max-w-xl text-sm leading-7 text-[var(--muted-text)]">List an asset, set the clock, and let collectors bid. When time runs out, the highest bid wins.</p><div className="mt-5 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-[var(--muted-text)]"><span className="rounded-full border border-[var(--border-soft)] px-3 py-1.5">Arc Testnet · USDC</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{liveCount} live {liveCount === 1 ? "auction" : "auctions"}</span><span>5% minimum bid increases</span></div></div><button type="button" className={`${primary} shrink-0`} onClick={() => { if (!account.authenticated || !wallet) connect(); else setShowForm(!showForm); }}>{showForm ? <X size={16} /> : <Plus size={16} />}{showForm ? "Close form" : "Create an auction"}</button></div></div>
    <p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">Bids are held by the auction contract. If you are outbid, withdraw your previous bid below. A confirmed settlement releases the winning payment, minus the disclosed platform fee. The seller handles asset delivery. Test USDC has no monetary value.</p>
    {(!marketAddress || capability.data === false) && <div className="mt-5 rounded-2xl border border-[var(--border-soft)] p-5 text-xs leading-6">Digital and physical auction creation is awaiting contract setup. Existing NFT auctions and withdrawals remain available below.<ReviewerOnly><Link href="/settings/protocol" className="ml-1 font-semibold text-[#b55fbe] underline">Update the auction contract →</Link></ReviewerOnly></div>}
    {!protocol.isTestnet && <p className="mt-4 text-xs">Asset auctions are available on Arc Testnet.</p>}
    {(!account.authenticated || !wallet || !tx.isConnected) && <button type="button" className={`${button} mt-5`} disabled={!account.ready} onClick={connect}>{!account.authenticated ? "Sign in to bid or sell" : "Connect your linked wallet"}</button>}
    {tx.isWrongNetwork && <button type="button" className={`${button} mt-5`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button>}
    {showForm && <form key={storageKey || "guest"} onSubmit={createAuction} className="gallery-card mt-6 p-5 sm:p-7" aria-label="Create an asset auction"><div className="flex items-center justify-between gap-3"><h3 className="text-2xl">Bring your asset to auction</h3><button type="button" className={button} aria-label="Close auction form" onClick={() => setShowForm(false)}><X size={15} /></button></div><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">You set the starting bid and delivery terms. Asset details are locked when you prepare the auction, then your wallet confirms it on Arc.</p><fieldset disabled={preparing || tx.pending || uploading || registering} className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2"><label className="text-xs font-semibold">Asset type<select value={kind} onChange={(event) => setKind(event.target.value as AssetAuctionKind)} className={`${input} mt-2`}><option value="DIGITAL">Digital asset</option><option value="PHYSICAL">Physical asset</option></select></label><label className="text-xs font-semibold">Title<input name="title" className={`${input} mt-2`} required minLength={3} maxLength={120} placeholder="What are you auctioning?" /></label><label className="text-xs font-semibold sm:col-span-2">Description<textarea name="description" className={`${input} mt-2`} rows={3} required minLength={20} maxLength={4000} placeholder="Describe the asset, its condition and what the winner receives." /></label><label className="text-xs font-semibold">Starting bid (USDC)<input className={`${input} mt-2`} type="number" min="0.000001" max="1000000" step="0.000001" required value={reserve} onChange={(event) => setReserve(event.target.value)} placeholder="10" /></label><label className="text-xs font-semibold">Auction ends · your local time<input name="ends" type="datetime-local" className={`${input} mt-2`} required /><span className="mt-1 block text-[10px] font-normal text-[var(--muted-text)]">Between 2 minutes and 30 days from now.</span></label><label className="text-xs font-semibold">Asset image<input type="file" accept="image/jpeg,image/png,image/webp" className={`${input} mt-2 text-xs`} onChange={(event) => void upload(event.target.files?.[0])} required={!imageUrl} /><span role="status" className="mt-1 block text-[10px] font-normal text-[var(--muted-text)]">{uploading ? "Uploading image…" : imageUrl ? "Image uploaded" : "Upload a clear image of your asset."}</span>{imageUrl && <div className="relative mt-3 h-28 w-28 overflow-hidden rounded-xl"><Image src={imageUrl} alt="Your auction asset preview" fill unoptimized className="object-cover" /></div>}</label><label className="text-xs font-semibold">Delivery terms<textarea name="deliveryTerms" className={`${input} mt-2`} rows={4} required minLength={20} maxLength={2000} placeholder={kind === "PHYSICAL" ? "Shipping locations, shipping cost, pickup options and delivery time." : "File format, usage rights and what the delivery link includes."} /></label>{kind === "DIGITAL" && <label className="text-xs font-semibold sm:col-span-2">Private digital delivery link<input name="digitalDeliveryUrl" type="url" pattern="https://.*" required maxLength={2000} className={`${input} mt-2`} placeholder="https://…" /><span className="mt-1 block text-[10px] font-normal leading-5 text-[var(--muted-text)]">Only the authenticated winning wallet receives this link after settlement. Use a link that lets the winner access the asset.</span></label>}</fieldset><PlatformFeeBreakdown terms={fees.data} gross={enteredUsdc(reserve)} proceedsLabel="Seller receives" totalLabel="Starting bid" isError={fees.isError} onRetry={() => void fees.refetch()} /><p className="mb-4 text-xs leading-6 text-[var(--muted-text)]">The timer has a fixed deadline. The winning payment becomes withdrawable by you after settlement; you are responsible for delivery.</p><button className={primary} disabled={!canAct || !capability.data || !fees.data || fees.isError || uploading || preparing || registering || !now}>{preparing ? "Preparing auction…" : tx.pending ? "Confirming on Arc…" : "Prepare & confirm auction"}</button></form>}
    {(drafts.length > 0 || pending.length > 0) && account.authenticated && wallet && <section className="mt-6 rounded-2xl border border-[#b55fbe]/25 bg-[#b55fbe]/5 p-5" aria-label="Recover auction registration"><h3 className="text-sm font-semibold">Your unpublished auctions</h3><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Your draft is saved. If the wallet transaction has confirmed, register it here to publish. Registration never sends another transaction.</p>{Array.from(new Set([...drafts.map((draft) => draft.id), ...pending.map((entry) => entry.id)])).map((id) => <DraftAuctionRecovery key={`${storageKey}:${id}`} id={id} draft={drafts.find((entry) => entry.id === id)} saved={pending.find((entry) => entry.id === id)} tx={tx} now={now} canAct={canAct} registering={registering} onPublish={publish} onActivate={retryActivation} />)}</section>}
    {chain.data?.balances.filter((balance) => balance.error).map((balance) => <p key={balance.address} role="alert" className="mt-4 text-xs text-rose-500">{balance.error} Contract {short(balance.address)}. <button type="button" className="underline" onClick={() => void chain.refetch()}>Retry balance check</button></p>)}
    {chain.data?.balances.filter((balance) => balance.amount > BigInt(0)).map((balance) => <div key={balance.address} className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4"><div><p className="text-sm font-semibold">{displayUsdc(balance.amount)} USDC ready to withdraw</p><p className="mt-1 text-[10px] text-[var(--muted-text)]">Your refunds and settled proceeds · {short(balance.address)}</p></div><button type="button" disabled={!canAct} className={button} onClick={() => void tx.run((write) => write({ address: balance.address, abi: auctionAbi, functionName: "withdraw", args: [tx.address!], chainId: arcChain.id }), refresh)}><ArrowDownLeft size={14} />Withdraw USDC</button></div>)}
    <div className="mt-5"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div>
    <div className="mt-9 flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-2" role="group" aria-label="Filter asset auctions">{([ ["ALL", "All assets"], ["DIGITAL", "Digital"], ["PHYSICAL", "Physical"], ["LIVE", "Live"], ["ENDED", "Ended"] ] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} className={`${button} ${filter === key ? "border-[#b55fbe]/40 bg-[#b55fbe]/10 text-[#b55fbe]" : ""}`} onClick={() => setFilter(key)}>{label}</button>)}</div><label className="relative min-w-0 max-w-full"><Search size={14} className="pointer-events-none absolute left-3 top-3.5 text-[var(--muted-text)]" /><input aria-label="Search asset auctions" placeholder="Search assets" className={`${input} py-2.5 pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    {listings.isLoading ? <p role="status" className="py-12 text-center text-sm text-[var(--muted-text)]">Loading asset auctions…</p> : listings.isError ? <div className="gallery-card mt-6 p-8 text-center"><p role="alert" className="text-sm">{listings.error.message}</p><button type="button" className={`${button} mt-4`} onClick={() => void listings.refetch()}>Retry loading auctions</button></div> : shown.length ? <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{shown.map((listing) => <AssetCard key={listing.id} listing={listing} state={chain.isError ? { error: "Arc verification is unavailable. Retry verification before bidding." } : chain.data?.records[listing.id]} now={now} tx={tx} account={account} refresh={refresh} />)}</div> : <div className="gallery-card mt-6 py-14 text-center"><Gavel size={30} className="mx-auto text-[#b55fbe]" /><h3 className="mt-4 text-2xl">{assets.length ? "No auctions match your search" : "The room is ready for your first asset"}</h3><p className="mx-auto mt-3 max-w-sm px-4 text-xs leading-6 text-[var(--muted-text)]">{assets.length ? "Choose another filter or search for a different asset." : "Put a digital creation or physical collectible in the spotlight. Set a starting bid and let the clock do the rest."}</p></div>}
    {chain.isError && <p role="alert" className="mt-4 text-xs text-rose-500">Arc auction verification is unavailable. Bidding remains disabled until verification succeeds. <button type="button" className="underline" onClick={() => void chain.refetch()}>Retry verification</button></p>}
    {listings.data?.hasMore && <button type="button" className={`${button} mt-6`} onClick={() => setPages((count) => count + 1)}>Load more auctions</button>}
    <div className="mt-8 grid gap-5 border-t border-[var(--border-soft)] pt-6 sm:grid-cols-3">{[{ Icon: ImagePlus, title: "List your asset", text: "Choose digital or physical, add real photos and spell out what the winner receives." }, { Icon: Clock3, title: "Let the bidding run", text: "Every bid must meet the starting price or raise the highest bid by at least 5%. Bidding stops at the deadline." }, { Icon: ShieldCheck, title: "Settle & deliver", text: "Confirm settlement after the timer. The winner gets the private delivery link or shares their address with the seller." }].map(({ Icon, title, text }) => <div key={title} className="p-2"><Icon size={19} className="text-[#b55fbe]" /><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">{text}</p></div>)}</div>
  </section>;
}
