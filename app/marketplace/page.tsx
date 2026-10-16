"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import ArticLogo from "@/components/ArticLogo";
import ThemeToggle from "@/components/ThemeToggle";
import ConnectWalletButton from "@/components/ConnectWalletButton";

type Mode = "nft" | "art";

type MarketplaceItem = {
  id: string;
  itemType: "NFT" | "WEB2_ART";
  title: string;
  description: string | null;
  imageUrl: string | null;
  mintPriceUsdc: number | null;
  status: "UPCOMING" | "LIVE" | "MINTED_OUT" | "LISTED" | null;
  category: "PAINTING" | "RUG" | "COSMETIC" | "OTHER" | null;
  priceUsdc: number | null;
  sold: boolean;
  creator: { walletAddress: string; username: string | null };
};

const STATUS_FILTERS = ["Upcoming", "Live", "Listed", "Sold"] as const;
const SORT_OPTIONS = ["Price: low to high", "Price: high to low", "Newest", "Ending soon"] as const;
const RARITY_FILTERS = ["Common", "Rare", "Epic", "Legendary"] as const;
const ART_CATEGORIES = ["Painting", "Artistic rug", "Artistic cosmetic", "Other"] as const;

const NFT_STATUS_STYLE: Record<NonNullable<MarketplaceItem["status"]>, { bg: string; text: string }> = {
  UPCOMING: { bg: "#F49BC5", text: "#362A67" },
  LIVE: { bg: "#2FE6A6", text: "#0B3B2E" },
  MINTED_OUT: { bg: "#362A67", text: "#FFFFFF" },
  LISTED: { bg: "#7C74C4", text: "#FFFFFF" },
};

const CATEGORY_LABEL: Record<NonNullable<MarketplaceItem["category"]>, string> = {
  PAINTING: "Painting",
  RUG: "Artistic rug",
  COSMETIC: "Artistic cosmetic",
  OTHER: "Other",
};

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 11 14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ItemCard({ item }: { item: MarketplaceItem }) {
  const isNft = item.itemType === "NFT";
  const badge = isNft && item.status ? NFT_STATUS_STYLE[item.status] : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)]">
      <div className="relative aspect-square bg-[var(--chip-bg)]">
        {badge && (
          <span
            className="absolute left-3 top-3 rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.05em]"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {item.status}
          </span>
        )}
        {!isNft && (
          <span className="absolute left-3 top-3 rounded bg-white/90 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.05em] text-[#362A67]">
            {item.sold ? "SOLD" : item.category ? CATEGORY_LABEL[item.category] : "ART"}
          </span>
        )}
      </div>
      <div className="space-y-1 p-4">
        <p className="text-sm font-semibold text-[var(--page-text)]">{item.title}</p>
        <p className="text-xs text-[var(--faint-text)]">
          {isNft
            ? item.mintPriceUsdc != null
              ? `Mint price ${item.mintPriceUsdc} USDC`
              : "Mint price — USDC"
            : item.priceUsdc != null
              ? `${item.priceUsdc} USDC`
              : "Price — USDC"}
        </p>
      </div>
    </div>
  );
}

function MarketplaceShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode: Mode = searchParams.get("mode") === "art" ? "art" : "nft";

  function setMode(next: Mode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("mode", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const itemType = mode === "nft" ? "NFT" : "WEB2_ART";
  const { data, isLoading, isError } = useQuery({
    queryKey: ["items", itemType],
    queryFn: async (): Promise<MarketplaceItem[]> => {
      const res = await fetch(`/api/items?itemType=${itemType}`);
      if (!res.ok) throw new Error("Failed to load items");
      const json = await res.json();
      return json.items;
    },
  });

  const items = data ?? [];

  return (
    <main className="min-h-screen w-full bg-[var(--page-bg)] text-[var(--page-text)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--page-bg)]/90 backdrop-blur">
        <div className="grid grid-cols-2 items-center gap-4 px-6 py-4 sm:px-10 lg:grid-cols-[1fr_auto_1fr] lg:px-16 xl:px-20">
          <Link href="/" className="justify-self-start">
            <ArticLogo className="text-xl sm:text-2xl" />
          </Link>

          <div className="col-span-2 order-3 flex justify-center lg:order-none lg:col-span-1">
            <div
              role="tablist"
              aria-label="Marketplace mode"
              className="inline-flex rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] p-1"
            >
              {(["nft", "art"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={mode === option}
                  onClick={() => setMode(option)}
                  className={`rounded-full px-5 py-2 text-sm font-semibold uppercase tracking-[0.08em] transition ${
                    mode === option ? "bg-[#EF476F] text-white" : "text-[var(--muted-text)] hover:text-[var(--page-text)]"
                  }`}
                >
                  {option === "nft" ? "NFTs" : "Art"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <label className="relative hidden items-center md:flex">
              <span className="pointer-events-none absolute left-3 text-[var(--faint-text)]">
                <SearchIcon />
              </span>
              <input
                type="search"
                placeholder="Search collections, art, or creators"
                className="w-56 rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] py-2 pl-9 pr-4 text-sm text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none focus:ring-2 focus:ring-[#EF476F]/40 lg:w-72"
              />
            </label>

            <ThemeToggle />

            <ConnectWalletButton />
          </div>
        </div>
      </header>

      <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[240px_1fr] lg:gap-10 lg:px-16 lg:py-12 xl:px-20">
        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">Status</h2>
            <div className="mt-3 space-y-2">
              {STATUS_FILTERS.map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm text-[var(--muted-text)]">
                  <input type="checkbox" className="h-4 w-4 rounded border-[var(--border-soft)] accent-[#EF476F]" />
                  {status}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">Price (USDC)</h2>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                placeholder="Min"
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none"
              />
              <span className="text-[var(--faint-text)]">–</span>
              <input
                type="number"
                placeholder="Max"
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">
              {mode === "nft" ? "Rarity" : "Category"}
            </h2>
            <div className="mt-3 space-y-2">
              {(mode === "nft" ? RARITY_FILTERS : ART_CATEGORIES).map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm text-[var(--muted-text)]">
                  <input type="checkbox" className="h-4 w-4 rounded border-[var(--border-soft)] accent-[#EF476F]" />
                  {item}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">Sort by</h2>
            <select className="mt-3 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--page-text)] focus:outline-none">
              {SORT_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
        </aside>

        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--muted-text)]">
              {isLoading ? "Loading…" : isError ? "Couldn't load items." : `${items.length} items`}
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)]">
                    <div className="aspect-square animate-pulse bg-[var(--chip-bg)]" />
                    <div className="space-y-2 p-4">
                      <div className="h-3 w-3/4 rounded bg-[var(--border-soft)]" />
                      <div className="h-3 w-1/2 rounded bg-[var(--border-soft)]" />
                    </div>
                  </div>
                ))
              : items.map((item) => <ItemCard key={item.id} item={item} />)}
          </div>

          {!isLoading && !isError && items.length === 0 && (
            <p className="mt-10 text-sm text-[var(--faint-text)]">
              No {mode === "nft" ? "NFT collections" : "art pieces"} yet — run <code>npm run db:seed</code> for sample
              data.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={null}>
      <MarketplaceShell />
    </Suspense>
  );
}
