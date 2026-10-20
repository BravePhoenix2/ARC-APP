"use client";

import Link from "next/link";
import { ArrowUpRight, Users } from "lucide-react";
import { useTesterLeaderboard } from "@/hooks/useTesterLeaderboard";

export default function TesterCount({ className = "" }: { className?: string }) {
  const leaderboard = useTesterLeaderboard();
  return <div className={`inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#b55fbe]/20 bg-[var(--glass-bg)] px-4 py-3 ${className}`}>
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#b55fbe]/10 text-[#b55fbe]"><Users size={17} aria-hidden="true" /></span>
      <div><p className="text-sm font-semibold tabular-nums">{leaderboard.data ? leaderboard.data.stats.totalUsers.toLocaleString() : "—"} <span className="font-medium">Testers</span></p><p className="mt-0.5 text-[10px] text-[var(--muted-text)]">{leaderboard.isError ? "Count temporarily unavailable" : "Verified accounts"}</p></div>
    </div>
    <Link href="/leaderboard" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#b55fbe] hover:underline">Leaderboard <ArrowUpRight size={12} aria-hidden="true" /></Link>
  </div>;
}
