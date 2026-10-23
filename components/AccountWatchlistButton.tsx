"use client";
import { Bookmark, LoaderCircle } from "lucide-react";
import { useWatchlist } from "@/hooks/useWatchlist";

export default function AccountWatchlistButton({ itemId, compact = false }: { itemId: string; compact?: boolean }) {
  const watchlist = useWatchlist(); const saved = watchlist.saved(itemId);
  return <span className="inline-flex max-w-full flex-col items-start gap-1">
    <button type="button" aria-label={saved ? "Remove from watchlist" : "Save to watchlist"} aria-pressed={saved} title={saved ? "Remove from watchlist" : "Save to watchlist"} disabled={!watchlist.ready || watchlist.saving || (watchlist.authenticated && (watchlist.isLoading || watchlist.isError))} onClick={(event) => { event.preventDefault(); event.stopPropagation(); watchlist.toggle(itemId); }} className={`inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--card-bg)] text-sm shadow-sm disabled:opacity-50 ${compact ? "h-9 w-9" : "px-4 py-2"} ${saved ? "text-[#b55fbe]" : "text-[var(--page-text)]"}`}>
      {watchlist.saving ? <LoaderCircle size={16} className="animate-spin" /> : <Bookmark size={16} fill={saved ? "currentColor" : "none"} />}{!compact && (saved ? "Saved" : "Watchlist")}
    </button>
    {watchlist.saveError && <span role="alert" className="max-w-48 rounded bg-[var(--card-bg)] p-1 text-[10px] text-rose-500">{watchlist.saveError}</span>}
    {watchlist.authenticated && watchlist.isError && !compact && <button type="button" className="text-xs underline" onClick={() => void watchlist.refetch()}>Retry watchlist</button>}
  </span>;
}
