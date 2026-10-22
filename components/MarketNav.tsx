"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ArticLogo from "@/components/ArticLogo";
import ConnectWalletButton from "@/components/ConnectWalletButton";

export default function MarketNav() {
  const pathname = usePathname();
  return <header className="gallery-nav border-b border-[var(--border-soft)] px-4 py-4 sm:px-8"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4"><Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link><nav aria-label="Marketplace navigation" className="order-3 flex w-full gap-6 overflow-x-auto pb-1 text-xs font-semibold xl:order-none xl:w-auto xl:text-sm">{[["/nfts", "NFTs"], ["/marketplace?mode=art", "ART BAZZAR"], ["/auctions", "Auctions"], ["/leaderboard", "Leaderboard"], ["/watchlist", "Watchlist"], ["/settings", "Settings"]].map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href.split("?")[0] ? "page" : undefined} className={`whitespace-nowrap ${pathname === href.split("?")[0] ? "text-[#b55fbe]" : "text-[var(--muted-text)] hover:text-[var(--page-text)]"}`}>{label}</Link>)}</nav><ConnectWalletButton /></div></header>;
}
