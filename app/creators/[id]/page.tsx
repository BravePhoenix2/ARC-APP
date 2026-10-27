"use client";
import { useEffect, useState } from "react";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Image from "next/image";
import MarketNav from "@/components/MarketNav";
import Atmosphere from "@/components/Atmosphere";
import CatalogCard from "@/components/CatalogCard";
import ShareItemButton from "@/components/ShareItemButton";
import type { BrowseItem } from "@/lib/marketplaceBrowse";

type Creator = { id: string; username: string | null; bio: string | null; avatarUrl: string | null; walletAddress: string | null; items: BrowseItem[] };
type CreatorPageResult = { creator: Creator; counts: { publishedWorks: number; nftCollections: number; artWorks: number }; nextCursor: string | null };

export default function CreatorPage() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [type, setType] = useState("ALL");
  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const profile = useInfiniteQuery({
    queryKey: ["creator", id, querySearch, type],
    initialPageParam: null as string | null,
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }): Promise<CreatorPageResult> => {
      const query = new URLSearchParams({ limit: "48" });
      if (pageParam) query.set("cursor", pageParam);
      if (querySearch) query.set("search", querySearch);
      if (type !== "ALL") query.set("itemType", type);
      const response = await fetch(`/api/creators/${encodeURIComponent(id)}?${query}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Creator unavailable.");
      return body;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
  });
  const creator = profile.data?.pages[0]?.creator;
  const counts = profile.data?.pages[0]?.counts;
  const name = creator?.username || "Artiq creator";
  const items = Array.from(new Map((profile.data?.pages.flatMap((page) => page.creator.items) || []).map((item) => [item.id, item])).values());
  return <main className="gallery-page min-h-screen"><Atmosphere /><MarketNav /><div className="mx-auto max-w-7xl px-5 py-12 sm:px-10">{profile.isLoading ? <p role="status">Loading creator…</p> : !creator ? <section className="gallery-card p-8"><h1 className="text-2xl">Creator unavailable</h1><p className="mt-3 text-sm text-[var(--muted-text)]">{profile.error?.message}</p><button type="button" onClick={() => void profile.refetch()} className="mt-4 underline">Try again</button></section> : <>
    <header className="gallery-card bg-gradient-to-br from-[#b55fbe]/10 p-6 sm:p-9"><div className="flex flex-wrap items-start justify-between gap-5"><div>{creator.avatarUrl && <div className="relative mb-4 h-20 w-20 overflow-hidden rounded-full"><Image src={creator.avatarUrl} alt="" fill unoptimized sizes="80px" className="object-cover" /></div>}<p className="text-xs font-semibold uppercase tracking-widest text-[#b55fbe]">Creator profile</p><h1 className="mt-3 text-4xl">{name}</h1></div><ShareItemButton title={name} /></div>{creator.bio && <p className="mt-5 max-w-2xl whitespace-pre-wrap text-sm leading-7 text-[var(--muted-text)]">{creator.bio}</p>}{creator.walletAddress && <p className="mt-4 break-all font-mono text-xs text-[var(--muted-text)]">{creator.walletAddress}</p>}<dl className="mt-7 flex flex-wrap gap-8">{[["Published works", counts?.publishedWorks], ["NFT collections", counts?.nftCollections], ["ART BAZZAR", counts?.artWorks]].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted-text)]">{label}</dt><dd className="mt-2 text-2xl font-semibold">{value}</dd></div>)}</dl></header>
    <div className="mt-8 flex flex-wrap gap-3"><input aria-label="Search creator works" placeholder="Search this creator’s work" value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm" /><select aria-label="Filter creator works" value={type} onChange={(event) => setType(event.target.value)} className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm"><option value="ALL">All work</option><option value="NFT">NFTs</option><option value="WEB2_ART">ART BAZZAR</option></select></div>
    <div aria-busy={profile.isFetching} className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((item) => <CatalogCard key={item.id} item={item} />)}</div>
    {!items.length && <p role="status" className="mt-8 text-sm text-[var(--muted-text)]">No published works match your search.</p>}
    {profile.isError && <p role="alert" className="mt-6 text-sm">{profile.error.message} <button type="button" className="underline" onClick={() => void (profile.isFetchNextPageError ? profile.fetchNextPage() : profile.refetch())}>Try again</button></p>}
    {profile.hasNextPage && <button type="button" disabled={profile.isFetching || profile.isPlaceholderData} onClick={() => void profile.fetchNextPage()} className="gallery-button mt-8 px-6 py-3 text-sm text-white disabled:opacity-50">{profile.isFetchingNextPage ? "Loading more works…" : "Load more works"}</button>}
  </>}</div></main>;
}
