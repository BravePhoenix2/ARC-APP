"use client";

import DailyMuse from "@/components/DailyMuse";
import Link from "next/link";
import Image from "next/image";
import { Settings2, X } from "lucide-react";
import { arcChain } from "@/lib/arcConfig";
import Atmosphere from "@/components/Atmosphere";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCatalogPage } from "@/hooks/useCatalogPage";
import ArticLogo from "@/components/ArticLogo";
import ThemeToggle from "@/components/ThemeToggle";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import TesterCount from "@/components/TesterCount";
import WatchlistButton from "@/components/WatchlistButton";
import { browseItems, priceRangeError } from "@/lib/marketplaceBrowse";
import { NFT_KIND_INFO, type NftKind } from "@/lib/nftTypes";

type Mode = "nft" | "art";

type MarketplaceItem = {
  id: string;
  itemType: "NFT" | "WEB2_ART";
  creationMethod?: "UNKNOWN" | "HUMAN" | "AI_GENERATED" | "AI_ASSISTED";
  nftKind?: NftKind | null;
  title: string;
  description: string | null;
  imageUrl: string | null;
  mintPriceUsdc: number | null;
  status: "UPCOMING" | "LIVE" | "MINTED_OUT" | "CLOSED" | "LISTED" | null;
  category: "PAINTING" | "RUG" | "COSMETIC" | "OTHER" | null;
  priceUsdc: number | null;
  sold: boolean;
  creator: { walletAddress: string | null; username: string | null };
};

const STATUS_FILTERS = ["Upcoming", "Live", "Listed", "Sold", "Closed"] as const;
const SORT_OPTIONS = ["Price: low to high", "Price: high to low", "Newest", "Mint starting soon"] as const;
const RARITY_FILTERS = ["Common", "Rare", "Epic", "Legendary"] as const;
const ART_CATEGORIES = ["Painting", "Artistic rug", "Artistic cosmetic", "Other"] as const;

const NFT_STATUS_STYLE: Record<NonNullable<MarketplaceItem["status"]>, { bg: string; text: string }> = {
  UPCOMING: { bg: "#F49BC5", text: "#362A67" },
  LIVE: { bg: "#2FE6A6", text: "#0B3B2E" },
  MINTED_OUT: { bg: "#362A67", text: "#FFFFFF" },
  CLOSED: { bg: "#6B6578", text: "#FFFFFF" },
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
    <div className="relative"><div className="absolute right-3 top-3 z-20"><WatchlistButton itemId={item.id} compact /></div><Link prefetch={false} href={isNft ? `/nfts/${item.id}` : `/art/${item.id}`} className="gallery-card block cursor-pointer overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b55fbe]">
      <div className="gallery-card-media relative aspect-square bg-[var(--chip-bg)]">
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.title} fill unoptimized sizes="(min-width: 1280px) 22vw, (min-width: 640px) 30vw, 45vw" className="object-cover" />
        ) : (
          <div className="art-placeholder absolute inset-0">
            <span className="art-placeholder-shape" aria-hidden="true" />
            <span className="text-[9px] uppercase tracking-[.16em]">Artwork coming soon</span>
          </div>
        )}
        {badge && (
          <span
            className="absolute left-3 top-3 z-10 rounded px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.05em]"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {item.status}
          </span>
        )}
        {!isNft && (
          <span className="absolute left-3 top-3 z-10 rounded bg-white/90 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.05em] text-[#362A67]">
            {item.sold ? "SOLD" : item.category ? CATEGORY_LABEL[item.category] : "ART"}
          </span>
        )}
      </div>
      <div className="space-y-2 p-4">
        {isNft && <span className="inline-block rounded-full border border-[var(--border-soft)] px-2 py-1 text-[9px] font-semibold">{NFT_KIND_INFO[item.nftKind || "COLLECTIBLE"].label}{item.nftKind === "SOULBOUND" ? " · Non-transferable" : ""}</span>}
        {isNft && (item.creationMethod === "AI_GENERATED" || item.creationMethod === "AI_ASSISTED") && <span className="inline-block rounded-full bg-[#b55fbe]/10 px-2 py-1 text-[9px] font-semibold text-[var(--muted-text)]">{item.creationMethod === "AI_GENERATED" ? "AI-generated NFT" : "AI-assisted NFT"}</span>}
        <p className="truncate text-[10px] font-medium tracking-wide text-[var(--faint-text)]">{item.creator.username || (item.creator.walletAddress ? `${item.creator.walletAddress.slice(0, 6)}…${item.creator.walletAddress.slice(-4)}` : "Artiq creator")}</p>
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
        <span className="mt-3 inline-flex rounded-full border border-[#b55fbe]/30 px-3 py-2 text-xs font-semibold text-[#b55fbe]">{isNft ? "View collection & mint" : "View artwork & checkout"} ↗</span>
      </div>
    </Link></div>
  );
}

function MarketplaceShell() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const mode: Mode = searchParams.get("mode") === "art" ? "art" : "nft";
  const savedSearch = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(savedSearch);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [facets, setFacets] = useState<string[]>([]);
  const [sort, setSort] = useState("Newest");
  function resetFilters() { setMinPrice(""); setMaxPrice(""); setStatuses([]); setFacets([]); setSort("Newest"); }
  function toggle(value: string, values: string[], update: (values: string[]) => void) { update(values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]); }

  useEffect(() => {
    setSearch(savedSearch);
  }, [savedSearch]);

  function updateSearchUrl(value: string, nextMode?: Mode) {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    if (nextMode) params.set("mode", nextMode);
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateSearchUrl(search);
  }

  function clearSearch() {
    setSearch("");
    updateSearchUrl("");
  }

  function setMode(next: Mode) {
    resetFilters();
    updateSearchUrl(search, next);
  }

  const itemType = mode === "nft" ? "NFT" : "WEB2_ART";
  const catalog = useCatalogPage<MarketplaceItem>(itemType);
  const { data, isLoading, isError } = catalog;

  const allItems = data ?? [];
  const searchTerms = search.trim().split(/\s+/).filter(Boolean);
  const rangeError = priceRangeError(minPrice, maxPrice);
  const items = browseItems(allItems, { search, min: minPrice, max: maxPrice, statuses, facets, sort });

  return (
    <main className="gallery-page min-h-screen w-full text-[var(--page-text)]">
      <Atmosphere />
      <header className="gallery-nav sticky top-0 z-30 border-b border-[var(--border-soft)]">
        <div className="grid grid-cols-[auto_1fr] items-center gap-4 px-6 py-4 sm:px-10 lg:grid-cols-[auto_auto_minmax(180px,1fr)_auto] lg:px-16 xl:px-20">
          <Link href="/" className="justify-self-start">
            <ArticLogo className="text-xl sm:text-2xl" />
          </Link>

          <div className="order-3 col-span-2 flex justify-center lg:order-none lg:col-span-1">
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
                    mode === option ? "gallery-button text-white" : "text-[var(--muted-text)] hover:text-[var(--page-text)]"
                  }`}
                >
                  {option === "nft" ? "NFTs" : "ART BAZZAR"}
                </button>
              ))}
            </div>
          </div>

          <form role="search" onSubmit={submitSearch} className="relative order-4 col-span-2 flex min-w-0 items-center lg:order-none lg:col-span-1">
            <input
              type="search"
              aria-label="Search marketplace"
              aria-controls="marketplace-results"
              placeholder="Search art or creators"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") clearSearch(); }}
              maxLength={200}
              className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] py-2 pl-4 pr-20 text-sm text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none focus:ring-2 focus:ring-[#EF476F]/40 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={clearSearch} className="absolute right-10 flex h-8 w-8 items-center justify-center rounded-full text-[var(--muted-text)] hover:bg-[var(--border-soft)]">
                <X size={14} aria-hidden="true" />
              </button>
            )}
            <button type="submit" aria-label="Search" className="absolute right-1 flex h-8 w-8 items-center justify-center rounded-full text-[var(--page-text)] hover:bg-[var(--border-soft)]">
              <SearchIcon />
            </button>
          </form>

          <div className="order-2 flex min-w-0 items-center justify-end gap-2 sm:gap-3 lg:order-none">

            <Link href="/settings" aria-label="Settings" title="Settings" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] transition hover:bg-[var(--chip-bg)]">
              <Settings2 size={16} aria-hidden="true" />
            </Link>
            <ThemeToggle />

            <ConnectWalletButton />
          </div>
        </div>
        <nav aria-label="Explore Artiq" className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 border-t border-[var(--border-soft)] px-5 py-3 text-[11px] font-semibold"><Link href="/nfts">NFT collections</Link><Link href="/nfts/create">Creator studio</Link><Link href="/auctions">Auctions</Link><Link href="/leaderboard">Leaderboard</Link><Link href="/watchlist">Watchlist</Link><Link href="/apply?type=WEB2_ART">Submit to ART BAZZAR</Link></nav>
      </header>

      {arcChain.testnet && <div className="border-b border-[var(--border-soft)] bg-[#b55fbe]/10 px-6 py-2 text-center text-xs leading-5 text-[var(--muted-text)]">Arc Testnet pilot · Test USDC only, no real money. <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">Get test USDC ↗</a></div>}
      <section className="market-intro relative px-6 py-10 sm:px-10 lg:px-16 xl:px-20">
        <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--muted-text)]"><span className="h-1.5 w-1.5 rounded-full bg-[#EF476F]" /> The Artiq collection</p>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">{mode === "nft" ? <>Art without <span className="hero-word">limits.</span></> : <>Made by hand. <span className="hero-word">Collected by you.</span></>}</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--muted-text)]">{mode === "nft" ? "Discover digital expressions, fresh perspectives, and your next collectible." : "Explore original pieces, tactile textures, and art that lives beyond the screen."}</p>
        <Link href={mode === "nft" ? "/nfts/create" : "/apply?type=WEB2_ART"} className="gallery-button mt-5 inline-flex items-center px-5 py-3 text-sm font-semibold text-white">Submit your {mode === "nft" ? "NFT collection" : "art"} <span aria-hidden="true">↗</span></Link>
        <div className="mt-5"><TesterCount /></div>
      </section>

      <div className="px-6 sm:px-10 lg:px-16 xl:px-20"><DailyMuse mode={mode === "nft" ? "NFT" : "WEB2_ART"} /></div>

      <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[240px_1fr] lg:gap-10 lg:px-16 lg:py-12 xl:px-20">
        <aside className="gallery-filter space-y-8 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">Status</h2>
            <div className="mt-3 space-y-2">
              {(mode === "nft" ? STATUS_FILTERS : ["Available", "Sold"]).map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm text-[var(--muted-text)]">
                  <input type="checkbox" checked={statuses.includes(status)} onChange={() => toggle(status, statuses, setStatuses)} className="h-4 w-4 rounded border-[var(--border-soft)] accent-[#EF476F]" />
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
                placeholder="Min" aria-label="Minimum price in USDC" min="0" step="0.000001" value={minPrice} onChange={(event) => setMinPrice(event.target.value)}
                className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none"
              />
              <span className="text-[var(--faint-text)]">–</span>
              <input
                type="number"
                placeholder="Max" aria-label="Maximum price in USDC" min="0" step="0.000001" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}
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
                  <input type="checkbox" checked={facets.includes(item)} onChange={() => toggle(item, facets, setFacets)} className="h-4 w-4 rounded border-[var(--border-soft)] accent-[#EF476F]" />
                  {item}
                </label>
              ))}
            </div>
          </div>

          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-[var(--faint-text)]">Sort by</h2>
            <select aria-label="Sort marketplace items" value={sort} onChange={(event) => setSort(event.target.value)} className="mt-3 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm text-[var(--page-text)] focus:outline-none">
              {SORT_OPTIONS.filter((option) => mode === "nft" || option !== "Mint starting soon").map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            {rangeError && <p role="alert" className="mt-3 text-xs text-rose-500">{rangeError}</p>}
            <button type="button" onClick={resetFilters} className="mt-4 text-xs font-semibold text-[#b55fbe]">Clear filters</button>
          </div>
        </aside>

        <div id="marketplace-results">
          <div className="flex items-center justify-between">
            <p role="status" aria-live="polite" className="text-sm text-[var(--muted-text)]">
              {isLoading ? "Loading…" : isError ? "Couldn't load items." : searchTerms.length
                ? `${items.length} ${items.length === 1 ? "result" : "results"} for “${search.trim()}”`
                : `${items.length} ${items.length === 1 ? "item" : "items"}`}
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

          <div className="mt-6 flex items-center justify-center gap-4 text-xs">
            <button disabled={!catalog.hasPrevious || catalog.isFetching} onClick={catalog.previous}>Previous</button>
            <span>Page {catalog.page} · Filters apply to this page</span>
            <button disabled={!catalog.hasNext || catalog.isFetching} onClick={catalog.next}>Next</button>
          </div>
          {isError && <button className="mt-4 text-sm" onClick={() => void catalog.refetch()}>Try again</button>}
          {!isLoading && !isError && items.length === 0 && (
            <div className="mt-10 rounded-xl border border-[var(--border-soft)] p-6">
              <h2 className="text-lg font-semibold">No matching {mode === "nft" ? "collections" : "art pieces"}</h2>
              <p className="mt-2 text-sm text-[var(--muted-text)]">Try a broader price range, fewer filters, or another search.</p>
              <button type="button" onClick={() => { clearSearch(); resetFilters(); }} className="mt-4 text-sm font-semibold text-[#EF476F]">Clear search & filters</button>
            </div>
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
