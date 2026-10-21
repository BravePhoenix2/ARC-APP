export type BrowseItem = {
  id: string; itemType: "NFT" | "WEB2_ART"; title: string; description: string | null; imageUrl: string | null;
  mintPriceUsdc: number | null; priceUsdc: number | null; status?: string | null; category?: string | null;
  sold: boolean; createdAt?: string; mintStartTime?: string | null; rarities?: unknown;
  creator: { id?: string; username: string | null; walletAddress: string | null };
};
export type BrowseFilters = { search?: string; min?: string; max?: string; statuses?: string[]; facets?: string[]; sort?: string };
const categories: Record<string, string> = { Painting: "PAINTING", "Artistic rug": "RUG", "Artistic cosmetic": "COSMETIC", Other: "OTHER" };
export function priceRangeError(min = "", max = ""): string | null {
  for (const value of [min, max]) if (value && (!/^\d+(\.\d{0,6})?$/.test(value) || !Number.isFinite(Number(value)))) return "Enter a non-negative USDC price with up to six decimals.";
  return min && max && Number(min) > Number(max) ? "Minimum price must not exceed maximum price." : null;
}
export function browseItems<T extends BrowseItem>(items: T[], filters: BrowseFilters): T[] {
  if (priceRangeError(filters.min, filters.max)) return [];
  const terms = (filters.search || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const price = (item: BrowseItem) => item.itemType === "NFT" ? item.mintPriceUsdc : item.priceUsdc;
  const filtered = items.filter((item) => {
    const text = [item.title, item.description, item.creator.username, item.creator.walletAddress].filter(Boolean).join(" ").toLowerCase();
    if (!terms.every((term) => text.includes(term))) return false;
    const amount = price(item);
    if ((filters.min || filters.max) && amount == null) return false;
    if (filters.min && amount! < Number(filters.min) || filters.max && amount! > Number(filters.max)) return false;
    if (filters.statuses?.length) {
      const label = item.itemType === "WEB2_ART" ? item.sold ? "Sold" : "Available" : ({ UPCOMING: "Upcoming", LIVE: "Live", LISTED: "Listed", MINTED_OUT: "Sold" } as Record<string, string>)[item.status || ""];
      if (!filters.statuses.includes(label)) return false;
    }
    if (filters.facets?.length) {
      if (item.itemType === "WEB2_ART") { if (!filters.facets.some((facet) => categories[facet] === item.category)) return false; }
      else {
        const rarities = Array.isArray(item.rarities) ? item.rarities.flatMap((entry) => entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string" ? [entry.name.toLowerCase()] : []) : [];
        if (!filters.facets.some((facet) => rarities.includes(facet.toLowerCase()))) return false;
      }
    }
    return true;
  });
  const date = (value?: string | null) => value ? Date.parse(value) || 0 : 0;
  return filtered.sort((a, b) => {
    if (filters.sort === "Price: low to high") return (price(a) ?? Infinity) - (price(b) ?? Infinity);
    if (filters.sort === "Price: high to low") return (price(b) ?? -Infinity) - (price(a) ?? -Infinity);
    if (filters.sort === "Mint starting soon") { const now = Date.now(); return (date(a.mintStartTime) > now ? date(a.mintStartTime) : Infinity) - (date(b.mintStartTime) > now ? date(b.mintStartTime) : Infinity); }
    return date(b.createdAt) - date(a.createdAt);
  });
}
