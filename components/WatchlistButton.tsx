"use client";

import dynamic from "next/dynamic";
import { Bookmark } from "lucide-react";
import { usePrivySession } from "@/hooks/usePrivySession";

const AccountWatchlistButton = dynamic(() => import("./AccountWatchlistButton"), {
  loading: () => <span role="status" className="text-xs text-[var(--muted-text)]">Loading watchlist…</span>,
});

/** Public discovery does not need to load wallet or private watchlist code. */
export default function WatchlistButton({ itemId, compact = false }: { itemId: string; compact?: boolean }) {
  const session = usePrivySession();
  if (session.authenticated) return <AccountWatchlistButton itemId={itemId} compact={compact} />;

  return <button type="button" aria-label="Save to watchlist" aria-pressed={false} title="Save to watchlist" disabled={!session.ready} onClick={(event) => {
    event.preventDefault(); event.stopPropagation(); session.login();
  }} className={`inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--card-bg)] text-sm shadow-sm disabled:opacity-50 ${compact ? "h-9 w-9" : "px-4 py-2"}`}>
    <Bookmark size={16} />{!compact && "Watchlist"}
  </button>;
}
