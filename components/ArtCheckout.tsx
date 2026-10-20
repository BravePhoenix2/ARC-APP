"use client";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Palette } from "lucide-react";
import { keccak256, toHex, zeroAddress, type Hash } from "viem";
import Atmosphere from "@/components/Atmosphere";
import MarketNav from "@/components/MarketNav";
import TransactionStatus from "@/components/TransactionStatus";
import { useProtocolTransaction } from "@/hooks/useProtocolTransaction";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { arcChain } from "@/lib/arcConfig";
import { artMarketAbi, displayUsdc, protocol, usdcAmount } from "@/lib/protocol";

type Art = { id: string; itemType: string; title: string; description: string | null; imageUrl: string | null; priceUsdc: number | null; artListingId: string | null; artListingSeller: string | null; creator: { username: string | null; walletAddress: string | null } };
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40";

export default function ArtCheckout({ id }: { id: string }) {
  const tx = useProtocolTransaction(); const account = useArtiqAccount();
  const identity = account.identity || "guest";
  const artQuery = useQuery({ queryKey: ["item-detail", id, identity], queryFn: async (): Promise<{ item: Art; isOwner: boolean }> => { const response = await fetch(`/api/items/${encodeURIComponent(id)}`, { cache: "no-store", headers: account.headers }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Artwork unavailable."); return data; } });
  const art = artQuery.data?.item;
  const market = protocol.artMarket;
  const chain = useQuery({ queryKey: ["art-checkout", art?.artListingId, market, tx.address], enabled: !!tx.client && !!market && protocol.isTestnet, refetchInterval: 12_000, queryFn: async () => {
    const [listing, proceeds] = await Promise.all([
      art?.artListingId ? tx.client!.readContract({ address: market!, abi: artMarketAbi, functionName: "listings", args: [BigInt(art.artListingId)] }) : null,
      tx.address ? tx.client!.readContract({ address: market!, abi: artMarketAbi, functionName: "pendingReturns", args: [tx.address] }) : BigInt(0),
    ]);
    if (listing && (listing[1] !== keccak256(toHex(id)) || listing[0].toLowerCase() !== art?.artListingSeller?.toLowerCase())) throw new Error("This on-chain listing does not match the approved artwork.");
    return { listing, proceeds };
  } });
  const authHeaders = account.headers;
  async function saveListing(txHash: Hash) {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}/art-listing`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify({ txHash }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Payment listing confirmed but could not be attached. Retry saving it below.");
    await artQuery.refetch(); await chain.refetch();
  }
  const listing = chain.data?.listing;
  const purchased = !!listing && listing[3] !== zeroAddress;
  const cancelled = listing?.[4] === true;
  const seller = !!listing && listing[0].toLowerCase() === tx.address?.toLowerCase();
  const canAct = !!market && protocol.isTestnet && tx.isConnected && !tx.pending && !tx.isWrongNetwork;
  const refresh = async () => { await chain.refetch(); await tx.refetchBalance(); };
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-8"><Link href="/marketplace?mode=art" className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-text)]"><ArrowLeft size={14} />Original Art</Link>{artQuery.isLoading ? <p role="status" className="mt-8">Loading artwork…</p> : artQuery.isError || art?.itemType !== "WEB2_ART" ? <div className="gallery-card mt-8 p-8"><h1 className="text-2xl">Artwork unavailable</h1><p className="mt-3 text-sm">Only approved original artwork is shown here.</p></div> : <div className="mt-7 grid gap-8 lg:grid-cols-2"><div className="gallery-card relative aspect-square overflow-hidden">{art.imageUrl && <Image src={art.imageUrl} alt={art.title} fill unoptimized sizes="(min-width:1024px) 50vw,100vw" className="object-cover" />}</div><div><p className="flex items-center gap-2 text-xs font-semibold text-[#b55fbe]"><Palette size={16} />Reviewed Original Art</p><h1 className="mt-5 text-4xl sm:text-5xl">{art.title}</h1><p className="mt-3 text-xs text-[var(--muted-text)]">By {art.creator.username || "Artiq creator"}</p><p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{art.description}</p><p className="mt-6 text-3xl">{listing ? displayUsdc(listing[2]) : art.priceUsdc} <span className="text-sm">USDC</span></p><div className="mt-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-5"><h2 className="text-sm font-semibold">Arc Testnet checkout</h2><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">This records a test payment to the creator. Arrange delivery and usage rights directly with the creator; this checkout does not provide shipping or delivery escrow. Test USDC has no monetary value.</p>{!market ? <Link href="/settings/protocol" className="mt-4 block text-xs font-semibold text-[#b55fbe]">Testnet checkout awaiting setup →</Link> : !art.artListingId ? <><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{artQuery.data?.isOwner ? "Create a payment listing from your connected wallet. Proceeds can be withdrawn by that wallet after a sale." : "The creator has not activated checkout for this artwork yet."}</p>{artQuery.data?.isOwner && <button className={`${button} mt-4`} disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market, abi: artMarketAbi, functionName: "createListing", args: [keccak256(toHex(id)), usdcAmount(String(art.priceUsdc))], chainId: arcChain.id }), saveListing)}>Activate artwork checkout</button>}{tx.hash && tx.error && artQuery.data?.isOwner && <button className="mt-3 block text-xs font-semibold underline" onClick={() => void saveListing(tx.hash!).catch((e) => tx.setError(e.message))}>Retry saving confirmed listing</button>}</> : chain.isError ? <p role="alert" className="mt-4 text-xs text-rose-500">Couldn’t verify this listing. Please refresh before paying.</p> : !listing ? <p role="status" className="mt-4 text-xs">Checking the on-chain listing…</p> : purchased ? <p className="mt-4 text-sm font-semibold text-emerald-600 dark:text-emerald-300">Purchased{listing[3].toLowerCase() === tx.address?.toLowerCase() ? " by your wallet — you can now join eligible reward rounds." : "."}</p> : cancelled ? <p className="mt-4 text-sm">Checkout was cancelled by the creator.</p> : <><button className={`${button} mt-4 w-full`} disabled={!canAct || seller || artQuery.data?.isOwner} onClick={() => void tx.run((write) => write({ address: market, abi: artMarketAbi, functionName: "buyListing", args: [BigInt(art.artListingId!)], value: listing[2], chainId: arcChain.id }), refresh)}>{seller || artQuery.data?.isOwner ? "Your artwork is available to collectors" : "Buy art with test USDC"}</button>{seller && <button className="mt-3 text-xs font-semibold underline" disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market, abi: artMarketAbi, functionName: "cancelListing", args: [BigInt(art.artListingId!)], chainId: arcChain.id }), refresh)}>Cancel checkout listing</button>}</>}{!!chain.data?.proceeds && <button className={`${button} mt-4`} disabled={!canAct} onClick={() => void tx.run((write) => write({ address: market!, abi: artMarketAbi, functionName: "withdraw", args: [tx.address!], chainId: arcChain.id }), refresh)}>Withdraw {displayUsdc(chain.data!.proceeds)} USDC proceeds</button>}</div>{tx.isWrongNetwork && <button className={`${button} mt-4`} onClick={() => void tx.switchToArc()}>Switch to Arc Testnet</button>}<div className="mt-5"><TransactionStatus pending={tx.pending} error={tx.error} hash={tx.hash} /></div><Link href="/auctions" className="mt-5 inline-block text-xs font-semibold text-[#b55fbe]">View community reward rounds →</Link></div></div>}</div></main>;
}
