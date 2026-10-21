"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import type { BrowseItem } from "@/lib/marketplaceBrowse";
export type WatchlistData = { ids: string[]; items: BrowseItem[] };
export function useWatchlist() {
  const account = useArtiqAccount(); const client = useQueryClient();
  const key = ["watchlist", account.identity || "guest"];
  const query = useQuery({ queryKey: key, enabled: account.authenticated, staleTime: 60_000, retry: false, queryFn: async (): Promise<WatchlistData> => {
    const response = await fetch("/api/watchlist", { headers: account.headers, cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Your watchlist could not be loaded."); return body;
  } });
  const mutation = useMutation({ mutationFn: async ({ id, saved }: { id: string; saved: boolean }) => {
    const response = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, { method: saved ? "DELETE" : "PUT", headers: account.headers }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not update your watchlist.");
  }, onSuccess: async () => { await client.invalidateQueries({ queryKey: key }); } });
  return { ...query, authenticated: account.authenticated, ready: account.ready,
    saving: mutation.isPending, saveError: mutation.error?.message,
    saved: (id: string) => query.data?.ids.includes(id) ?? false,
    toggle: (id: string) => { if (!account.authenticated) { account.login(); return; } mutation.mutate({ id, saved: query.data?.ids.includes(id) ?? false }); },
    login: account.login,
  };
}
