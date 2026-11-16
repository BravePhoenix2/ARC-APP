"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Sparkles } from "lucide-react";
import CreatorLink from "@/components/CreatorLink";
import WatchlistButton from "@/components/WatchlistButton";
import ShareItemButton from "@/components/ShareItemButton";
import { readMuseNotebook, stampMuse, type DailyMuseData, type MusePage } from "@/lib/dailyMuse";
const storageKey = "artiq:daily-muse:notebook:v1";
const button = "gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-semibold text-white";
export default function DailyMuse({ mode = "NFT" }: { mode?: "NFT" | "WEB2_ART" }) {
  const contentId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [pages, setPages] = useState<MusePage[]>([]);
  const [localOnly, setLocalOnly] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["daily-muse"], staleTime: 60000, refetchInterval: 300000, retry: false, queryFn: async ({ signal }): Promise<DailyMuseData> => {
    const response = await fetch("/api/discovery", { cache: "no-store", signal }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Today’s muse is unavailable."); return body;
  } });
  const { refetch } = query;
  useEffect(() => {
    const load = () => { try { setPages(readMuseNotebook(JSON.parse(localStorage.getItem(storageKey) || "[]"))); } catch { setLocalOnly(true); } };
    load(); window.addEventListener("storage", load); window.addEventListener("artiq:muse-revealed", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("artiq:muse-revealed", load); };
  }, []);
  const data = query.data;
  const item = data?.items.find((pick) => pick.itemType === mode) || data?.items[0];
  const key = data && item ? `${data.day}:${item.id}` : "";
  const open = !!item && (revealed === key || !!pages.find((page) => page.day === data?.day)?.items.includes(item.id));
  useEffect(() => {
    if (!data?.nextAt) return;
    const timer = window.setTimeout(() => { void refetch(); }, Math.max(1000, Date.parse(data.nextAt) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [data?.nextAt, refetch]);
  useEffect(() => { if (revealed === key && key) titleRef.current?.focus({ preventScroll: true }); }, [revealed, key]);
  function reveal() {
    if (!data || !item) return;
    setRevealed(key);
    let current = pages;
    try { current = readMuseNotebook(JSON.parse(localStorage.getItem(storageKey) || "[]")); } catch { setLocalOnly(true); }
    const next = stampMuse(current, data.day, item.id); setPages(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); window.dispatchEvent(new Event("artiq:muse-revealed")); } catch { setLocalOnly(true); }
  }
  if (!query.isLoading && !query.isError && !item) return null;
  return <section className="relative my-8 overflow-hidden rounded-[1.75rem] border border-[#b55fbe]/25 bg-[radial-gradient(ellipse_at_top_left,#b55fbe20,transparent_70%)] p-6 sm:p-8" aria-label="Daily Muse">
    <div className="grid items-center gap-6 md:grid-cols-[1fr_1.1fr]">
      <div><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-[#b55fbe]"><Sparkles size={14} aria-hidden="true" />Daily Muse · a little art ritual</p>
        <h2 className="mt-3 text-2xl sm:text-3xl">One day. One new perspective.</h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted-text)]">Unwrap a work from the Artiq community. Notice something new, meet its creator, and keep the ones that stay with you.</p>
        <p className="mt-4 inline-flex items-center gap-2 text-[11px] text-[var(--muted-text)]"><BookOpen size={14} aria-hidden="true" />Your notebook · {pages.length} discovery {pages.length === 1 ? "day" : "days"}</p>
        <p className="mt-2 text-[10px] text-[var(--faint-text)]">Notebook saved on this browser. New picks arrive at midnight Lagos time.</p>
        {query.isError && data && <p role="status" className="mt-2 text-xs text-[var(--muted-text)]">Showing the last available pick. <button type="button" className="underline" onClick={() => void query.refetch()}>Refresh pick</button></p>}
        {localOnly && <p role="status" className="mt-2 text-xs text-[var(--muted-text)]">Browser storage is unavailable; you can still reveal today’s work in this tab.</p>}
      </div>
      {query.isLoading ? <p role="status" className="p-8 text-sm text-[var(--muted-text)]">Finding today’s muse…</p> : query.isError && !data ? <div className="p-5"><p role="alert" className="text-sm">{query.error.message}</p><button className={`${button} mt-4`} onClick={() => void query.refetch()}>Try again</button></div> : item && data ? <div id={contentId} className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--card-bg)]">
        {!open ? <div className="relative flex min-h-64 flex-col items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,#b55fbe30,transparent_75%)] p-6 text-center"><div aria-hidden="true" className="absolute h-40 w-40 rotate-12 rounded-[2rem] border border-[#b55fbe]/25" /><div aria-hidden="true" className="absolute h-32 w-32 -rotate-12 rounded-full border border-[#b55fbe]/25" /><Sparkles size={28} className="relative text-[#b55fbe]" aria-hidden="true" /><p className="relative mt-4 text-xs font-semibold">{data.theme}</p><button type="button" aria-expanded={false} aria-controls={contentId} onClick={reveal} className={`${button} relative mt-5`}>Reveal today’s muse <Sparkles size={14} aria-hidden="true" /></button></div> : <div className="muse-reveal"><div className="flex gap-4 p-4">{item.imageUrl && <Link href={item.itemType === "NFT" ? `/nfts/${item.id}` : `/art/${item.id}`} className="relative h-32 w-28 shrink-0 overflow-hidden rounded-xl"><Image src={item.imageUrl} alt={item.title} fill unoptimized={!item.imageUrl.startsWith("/api/uploads/")} sizes="112px" className="object-cover" /></Link>}<div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wider text-[#b55fbe]">{item.itemType === "NFT" ? "NFT discovery" : "ART BAZZAR discovery"}</p><h3 ref={titleRef} tabIndex={-1} className="mt-2 break-words text-lg focus-visible:outline focus-visible:outline-[#b55fbe]">{item.title}</h3><p className="mt-1 text-xs text-[var(--muted-text)]">By <CreatorLink creator={item.creator} /></p><Link className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#b55fbe]" href={item.itemType === "NFT" ? `/nfts/${item.id}` : `/art/${item.id}`}>Meet this work <ArrowUpRight size={13} aria-hidden="true" /></Link></div></div><div className="border-t border-[var(--border-soft)] px-4 py-4"><p className="text-xs leading-6 text-[var(--muted-text)]">{data.prompt}</p><div className="mt-3 flex flex-wrap gap-3"><WatchlistButton itemId={item.id} /><ShareItemButton title={item.title} /></div><p role="status" className="mt-3 text-[10px] font-semibold text-[#b55fbe]">A new perspective, noted.</p></div></div>}
      </div> : null}
    </div>
  </section>;
}
