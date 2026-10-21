"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import MarketNav from "@/components/MarketNav";
import Atmosphere from "@/components/Atmosphere";
import CatalogCard from "@/components/CatalogCard";
import ShareItemButton from "@/components/ShareItemButton";
import { browseItems, type BrowseItem } from "@/lib/marketplaceBrowse";
type Creator = { id: string; username: string | null; bio: string | null; avatarUrl: string | null; walletAddress: string | null; items: BrowseItem[] };
export default function CreatorPage({ params }: { params: { id: string } }) {
  const [search, setSearch] = useState(""); const [type, setType] = useState("ALL");
  const profile = useQuery({ queryKey: ["creator", params.id], queryFn: async (): Promise<Creator> => { const response = await fetch(`/api/creators/${encodeURIComponent(params.id)}`); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Creator unavailable."); return body.creator; } });
  const creator = profile.data; const name = creator?.username || "Artiq creator";
  const items = browseItems(creator?.items || [], { search }).filter((item) => type === "ALL" || item.itemType === type);
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="mx-auto max-w-7xl px-5 py-12 sm:px-10">{profile.isLoading ? <p role="status">Loading creator…</p> : profile.isError || !creator ? <section className="gallery-card p-8"><h1 className="text-2xl">Creator unavailable</h1><p className="mt-3 text-sm text-[var(--muted-text)]">{profile.error?.message}</p></section> : <>
    <header className="gallery-card bg-gradient-to-br from-[#b55fbe]/10 p-6 sm:p-9"><div className="flex flex-wrap items-start justify-between gap-5"><div>{creator.avatarUrl && <div className="relative mb-4 h-20 w-20 overflow-hidden rounded-full"><Image src={creator.avatarUrl} alt="" fill unoptimized sizes="80px" className="object-cover" /></div>}<p className="text-xs font-semibold uppercase tracking-widest text-[#b55fbe]">Creator profile</p><h1 className="mt-3 text-4xl">{name}</h1></div><ShareItemButton title={name} /></div>{creator.bio && <p className="mt-5 max-w-2xl whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{creator.bio}</p>}{creator.walletAddress && <p className="mt-4 break-all font-mono text-xs text-[var(--muted-text)]">{creator.walletAddress}</p>}<dl className="mt-7 flex flex-wrap gap-8">{[["Published works", creator.items.length], ["NFT collections", creator.items.filter((item) => item.itemType === "NFT").length], ["ART BAZZAR", creator.items.filter((item) => item.itemType === "WEB2_ART").length]].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted-text)]">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value}</dd></div>)}</dl></header>
    <div className="mt-8 flex flex-wrap gap-3"><input aria-label="Search creator works" placeholder="Search this creator’s work" value={search} onChange={(event) => setSearch(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /><select aria-label="Filter creator works" value={type} onChange={(event) => setType(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm"><option value="ALL">All work</option><option value="NFT">NFTs</option><option value="WEB2_ART">ART BAZZAR</option></select></div><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => <CatalogCard key={item.id} item={item} />)}</div>{!items.length && <p role="status" className="mt-8 text-sm text-[var(--muted-text)]">No published works match your search.</p>}
  </>}</div></main>;
}
