"use client";
import { useState } from "react";
import { Share2 } from "lucide-react";
export default function ShareItemButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false); const [fallback, setFallback] = useState("");
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url); setCopied(true);
    } catch (error) { if ((error as Error).name !== "AbortError") setFallback(url); }
  }
  return <span className="inline-flex flex-col gap-2"><button type="button" onClick={() => void share()} className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2 text-sm"><Share2 size={16} />{copied ? "Link copied" : "Share"}</button>{fallback && <input aria-label="Copy this item link" value={fallback} readOnly onFocus={(event) => event.target.select()} className="rounded border bg-[var(--chip-bg)] p-2 text-xs" />}</span>;
}
