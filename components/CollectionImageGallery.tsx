import Image from "next/image";
export type GalleryImage = { position: number; filename: string; imageUrl: string };
export default function CollectionImageGallery({ images }: { images?: GalleryImage[] }) {
  if (!images?.length) return null;
  return <section className="mt-8" aria-label="Collection image series"><h3 className="text-lg font-semibold">Image series · {images.length} {images.length === 1 ? "image" : "images"}</h3><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Each image maps to its numbered NFT. Open an image to inspect it in full.</p><div className="mt-4 grid max-h-[36rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">{images.map((image) => <a key={image.position} href={image.imageUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-[var(--border-soft)] p-2"><div className="relative aspect-square overflow-hidden rounded-lg"><Image src={image.imageUrl} alt={image.filename} fill unoptimized sizes="180px" className="object-cover" /></div><p className="mt-2 truncate text-xs">#{image.position} · {image.filename}</p></a>)}</div></section>;
}
