"use client";
import { useState } from "react";
import Link from "next/link";
import MarketNav from "@/components/MarketNav";
import Atmosphere from "@/components/Atmosphere";
import CatalogCard from "@/components/CatalogCard";
import { useWatchlist } from "@/hooks/useWatchlist";
import { browseItems } from "@/lib/marketplaceBrowse";
export default function WatchlistPage() {
  const watchlist = useWatchlist(); const [search, setSearch] = useState(""); const [type, setType] = useState("ALL");
  const items = browseItems(watchlist.data?.items || [], { search }).filter((item) => type === "ALL" || item.itemType === type);
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="mx-auto max-w-7xl px-5 py-12 sm:px-10"><p className="text-xs uppercase tracking-widest text-[#b55fbe]">Your saved discoveries</p><h1 className="mt-3 text-4xl">My watchlist</h1><p className="mt-4 text-sm leading-7 text-[var(--muted-text)]">Keep NFT collections and ART BAZZAR finds close. Your watchlist is private to your account.</p>
    {!watchlist.ready ? <p role="status" className="mt-8">Loading account…</p> : !watchlist.authenticated ? <section className="gallery-card mt-8 p-8"><h2 className="text-xl">Sign in to save your favorites</h2><p className="mt-3 text-sm text-[var(--muted-text)]">Use the bookmark button on any item to keep it here.</p><button type="button" onClick={() => watchlist.login()} className="gallery-button mt-5 px-5 py-3 text-sm text-white">Sign in</button></section> : <>
      <div className="mt-8 flex flex-wrap gap-3"><input aria-label="Search saved items" placeholder="Search your watchlist" value={search} onChange={(event) => setSearch(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /><select aria-label="Filter saved items" value={type} onChange={(event) => setType(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm"><option value="ALL">All items</option><option value="NFT">NFTs</option><option value="WEB2_ART">ART BAZZAR</option></select></div>
      {watchlist.isLoading ? <p role="status" className="mt-8">Loading saved items…</p> : watchlist.isError ? <div role="alert" className="mt-8"><p>{watchlist.error.message}</p><button type="button" className="mt-3 underline" onClick={() => void watchlist.refetch()}>Try again</button></div> : items.length ? <><p role="status" className="mt-6 text-xs text-[var(--muted-text)]">{items.length} saved {items.length === 1 ? "item" : "items"}</p><div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => <CatalogCard key={item.id} item={item} />)}</div></> : <section className="gallery-card mt-8 p-8"><h2 className="text-xl">{search || type !== "ALL" ? "No saved items match these filters." : "Your next discovery belongs here."}</h2><Link href="/marketplace" className="mt-4 inline-block text-sm font-semibold text-[#b55fbe]">Explore the marketplace →</Link></section>}
    </>}
  </div></main>;
}
