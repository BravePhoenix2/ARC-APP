"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import type { MintPhaseConfig } from "@/lib/mintAccess";
import type { Hex } from "viem";
export type MintAccessData = { plan: null | { config: MintPhaseConfig; root: Hex | null; frozenAt: string | null; registrations: number }; entry?: { tier: string; requestedTier: string } | null; proof?: Hex[] | null; entries?: { walletAddress: string; requestedTier: string; tier: string }[] };
export function useMintAccess(id: string, manage = false) {
  const account = useArtiqAccount();
  const query = useQuery({ queryKey: ["mint-access", id, account.identity || "guest", account.walletAddress, manage], retry: false, refetchInterval: 30_000, queryFn: async (): Promise<MintAccessData> => {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}/mint-access${manage ? "?manage=1" : ""}`, { headers: account.headers, cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Mint access could not be loaded."); return body;
  } });
  const mutation = useMutation({ mutationFn: async (input: Record<string, unknown>) => {
    const response = await fetch(`/api/items/${encodeURIComponent(id)}/mint-access`, { method: "POST", headers: { ...account.headers, "Content-Type": "application/json" }, body: JSON.stringify(input) }); const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save mint access.");
  }, onSuccess: async () => { await query.refetch(); } });
  return { ...query, save: mutation.mutate, saving: mutation.isPending, saveError: mutation.error?.message };
}
