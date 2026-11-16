"use client";
import Image from "next/image";
import { useState } from "react";
import { useImageRetry } from "@/hooks/useImageRetry";
export type GalleryImage = { position: number; filename: string; imageUrl: string };

function GalleryImageTile({ image }: { image: GalleryImage }) {
  const cover = useImageRetry(image.imageUrl);
  return <div className="rounded-xl border border-[var(--border-soft)] p-2">
    <a href={image.imageUrl} target="_blank" rel="noreferrer" className="block">
      <div className="relative aspect-square overflow-hidden rounded-lg">{!cover.failed
        ? <Image key={cover.imageKey} src={cover.src} alt={image.filename} fill unoptimized sizes="180px" className="object-cover" onError={cover.onError} onLoad={cover.onLoad} />
        : <div className="flex h-full items-center justify-center bg-[var(--chip-bg)] p-3 text-center text-xs text-[var(--muted-text)]">{cover.retrying ? "Loading image…" : "Image unavailable"}</div>}
      </div><p className="mt-2 truncate text-xs">#{image.position} · {image.filename}</p>
    </a>
    {cover.failed && !cover.retrying && <button type="button" aria-label={`Retry image ${image.filename}`} className="mt-2 text-xs font-semibold text-[#b55fbe] underline" onClick={cover.retry}>Retry image</button>}
  </div>;
}
export default function CollectionImageGallery({ images }: { images?: GalleryImage[] }) {
  const [search, setSearch] = useState(""); const [sort, setSort] = useState("token");
  if (!images?.length) return null;
  const term = search.trim().toLowerCase();
  const filtered = images.filter((image) => !term || image.filename.toLowerCase().includes(term) || `#${image.position}` === term || String(image.position) === term).sort((a, b) => sort === "name" ? a.filename.localeCompare(b.filename, "en", { numeric: true }) : sort === "reverse" ? b.position - a.position : a.position - b.position);
  return <section className="mt-8" aria-label="Collection image series"><h3 className="text-lg font-semibold">Image series · {images.length} {images.length === 1 ? "image" : "images"}</h3><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Each image maps to its numbered NFT. Open an image to inspect it in full.</p><div className="mt-4 flex flex-wrap gap-3"><input aria-label="Search collection images" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filename or token #" className="min-w-0 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-sm" /><select aria-label="Sort collection images" value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-xs"><option value="token">Token: low to high</option><option value="reverse">Token: high to low</option><option value="name">Filename</option></select></div><p role="status" className="mt-3 text-xs text-[var(--muted-text)]">{filtered.length} of {images.length} images</p><div className="mt-4 grid max-h-[36rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">{filtered.map((image) => <GalleryImageTile key={`${image.position}:${image.imageUrl}`} image={image} />)}</div>{!filtered.length && <button type="button" onClick={() => setSearch("")} className="mt-4 text-xs font-semibold text-[#b55fbe]">No matches · Clear search</button>}</section>;
}
