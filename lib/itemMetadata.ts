/** Canonical token URLs must never depend on a caller-controlled Host header. */
export function canonicalAppOrigin(): string {
  const value = process.env.ARTIQ_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("APP_ORIGIN_UNCONFIGURED"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
    (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("APP_ORIGIN_UNCONFIGURED");
  return url.origin;
}

export function itemMetadataUri(item: { id: string; metadataUri: string | null; imageCount?: number }): string {
  return item.metadataUri || `${canonicalAppOrigin()}/api/items/${encodeURIComponent(item.id)}/metadata${(item.imageCount ?? 1) > 1 ? "/" : ""}`;
}

export function publicImageUrl(imageUrl: string | null): string | undefined {
  if (!imageUrl) return undefined;
  return imageUrl.startsWith("/") ? new URL(imageUrl, canonicalAppOrigin()).href : imageUrl;
}
