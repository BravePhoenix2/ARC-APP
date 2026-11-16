"use client";

import Image from "next/image";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

type Drop = { id: string; title: string; imageUrl: string | null; status: string | null };
type Trending = { items: Drop[]; nextAt: string };

export default function TrendingDrops() {
  const query = useQuery({
    queryKey: ["hourly-trending-drops"],
    queryFn: async ({ signal }): Promise<Trending> => {
      const response = await fetch("/api/trending", { signal });
      if (!response.ok) throw new Error("Trending drops could not be loaded.");
      return response.json();
    },
    staleTime: 60_000,
    retry: 1,
    // Refresh an open landing page at the next hour; suspended tabs catch up on focus.
    refetchInterval: (query) => {
      const nextAt = Date.parse(query.state.data?.nextAt ?? "");
      return Number.isFinite(nextAt) ? Math.max(30_000, nextAt - Date.now() + 1_000) : 60_000;
    },
  });

  if (query.isPending) return <div role="status" aria-label="Loading trending drops" className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((id) => <div key={id} className="aspect-square animate-pulse rounded-xl bg-[var(--chip-bg)]" />)}</div>;
  if (query.isError && !query.data) return <div role="alert" className="mt-10 text-sm text-[var(--muted-text)]"><p>Trending drops are temporarily unavailable.</p><button type="button" onClick={() => void query.refetch()} className="mt-3 font-semibold text-[#EF476F]">Try again</button></div>;
  if (!query.data?.items.length) return <p className="mt-10 text-sm text-[var(--muted-text)]">Newly published NFT collections will appear here in the next hourly update.</p>;

  return <div className="mt-10 grid grid-cols-2 gap-4 border-t border-[var(--border-soft)] pt-10 sm:gap-6 lg:mt-14 lg:grid-cols-4 lg:pt-14">
    {query.data.items.map((item) => <Link key={item.id} href={`/nfts/${encodeURIComponent(item.id)}`} prefetch={false} className="gallery-card overflow-hidden bg-[var(--card-bg)]">
      <div className="gallery-card-media relative aspect-square bg-[var(--chip-bg)]">
        {item.imageUrl ? <Image src={item.imageUrl} alt={item.title} fill unoptimized={!item.imageUrl.startsWith("/api/uploads/")} sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-[var(--muted-text)]">NFT collection</div>}
        {item.status && <span className="absolute left-3 top-3 rounded bg-white/90 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.05em] text-[#362A67]">{item.status.replaceAll("_", " ")}</span>}
      </div>
      <div className="p-4"><p className="text-sm font-semibold text-[var(--page-text)]">{item.title}</p></div>
    </Link>)}
  </div>;
}
