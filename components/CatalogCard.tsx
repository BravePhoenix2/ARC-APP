import Image from "next/image";
import Link from "next/link";
import WatchlistButton from "@/components/WatchlistButton";
import type { BrowseItem } from "@/lib/marketplaceBrowse";
export default function CatalogCard({ item }: { item: BrowseItem }) {
  const nft = item.itemType === "NFT"; const price = nft ? item.mintPriceUsdc : item.priceUsdc;
  return <article className="relative min-w-0"><div className="absolute right-3 top-3 z-20"><WatchlistButton itemId={item.id} compact /></div><Link prefetch={false} href={nft ? `/nfts/${item.id}` : `/art/${item.id}`} className="gallery-card block h-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#b55fbe]"><div className="relative aspect-square bg-[var(--chip-bg)]">{item.imageUrl ? <Image src={item.imageUrl} alt={item.title} fill unoptimized sizes="300px" className="object-cover" /> : <span className="absolute inset-0 flex items-center justify-center text-xs text-[var(--muted-text)]">Artwork coming soon</span>}</div><div className="space-y-2 p-4"><p className="text-[10px] text-[#b55fbe]">{nft ? "NFT collection" : item.sold ? "Original art · Sold" : "Original art"}</p><h2 className="truncate font-semibold">{item.title}</h2><p className="truncate text-xs text-[var(--muted-text)]">{item.creator.username || "Artiq creator"}</p><p className="text-sm">{price == null ? "Price to be announced" : `${price} USDC`}</p><p className="pt-2 text-xs font-semibold text-[#b55fbe]">{nft ? "View collection & mint" : "View artwork & checkout"} ↗</p></div></Link></article>;
}
