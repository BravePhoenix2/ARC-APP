"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

/** Each navigation replaces the visible page, bounding browser memory and DOM size. */
export function useCatalogPage<T>(itemType: "NFT" | "WEB2_ART") {
  const [navigation, setNavigation] = useState<{ type: string; cursors: (string | null)[] }>({ type: itemType, cursors: [null] });
  const cursors = navigation.type === itemType ? navigation.cursors : [null];
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: ["catalog-page", "cards", itemType, cursor],
    queryFn: async ({ signal }): Promise<{ items: T[]; nextCursor: string | null }> => {
      const params = new URLSearchParams({ itemType, view: "cards" });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/items?${params}`, { signal });
      if (!response.ok) throw new Error("Items could not be loaded. Please try again.");
      return response.json();
    },
    staleTime: 30_000,
    gcTime: 60_000,
    retry: 1,
  });
  return {
    ...query,
    data: query.data?.items,
    page: cursors.length,
    hasPrevious: cursors.length > 1,
    hasNext: Boolean(query.data?.nextCursor),
    previous: () => setNavigation({ type: itemType, cursors: cursors.slice(0, -1) }),
    next: () => { if (query.data?.nextCursor) setNavigation({ type: itemType, cursors: [...cursors, query.data.nextCursor] }); },
  };
}
