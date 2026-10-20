"use client";

import { useQuery } from "@tanstack/react-query";
import type { TesterEntry, TesterLeaderboardResponse } from "@/lib/testerPoints";

export type { TesterEntry };
export type TesterLeaderboard = TesterLeaderboardResponse;

export async function readTesterResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Tester activity could not be loaded. Please try again.");
  if (!body || typeof body !== "object") throw new Error("Tester activity could not be loaded. Please try again.");
  return body as T;
}

/** Public totals use the same live query as the first page of the leaderboard. */
export function useTesterLeaderboard(page = 1) {
  return useQuery({
    queryKey: ["tester-leaderboard", page],
    queryFn: async ({ signal }): Promise<TesterLeaderboard> => {
      const body = await readTesterResponse<TesterLeaderboard>(await fetch(`/api/leaderboard?page=${page}&pageSize=25`, { signal, cache: "no-store" }));
      if (!body.stats || !Array.isArray(body.entries) || !body.pagination) throw new Error("Tester activity could not be loaded. Please try again.");
      return body;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}
