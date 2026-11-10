"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { MAX_COLLECTION_IMAGES, type CollectionImageInput } from "@/lib/collectionImages";
import { maxImageBytes } from "@/lib/imageLimits";

type Props = { images: CollectionImageInput[]; onChange: (images: CollectionImageInput[]) => void; headers: Record<string, string>; busy: boolean; onBusy: (busy: boolean) => void; preview?: boolean };
const action = "rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-semibold disabled:opacity-40";
export default function CollectionFolderUpload({ images, onChange, headers, busy, onBusy, preview = false }: Props) {
  const files = useRef<HTMLInputElement>(null); const folder = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const localUrls = useRef<string[]>([]);
  const [progress, setProgress] = useState(""); const [error, setError] = useState("");
  useEffect(() => () => { controller.current?.abort(); localUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  async function upload(selected: FileList | null) {
    if (!selected || busy) return;
    setError("");
    const candidates = Array.from(selected).filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name) && !file.name.startsWith(".")).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, "en", { numeric: true }));
    if (!candidates.length) { setError("Choose a folder containing PNG, JPEG, or WebP images. ZIP archives are not supported."); return; }
    const names = new Set<string>();
    for (const file of candidates) {
      if (file.name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) { setError("Use filenames up to 200 characters without control characters or backslashes."); return; }
      if (names.has(file.name)) { setError("Image filenames must be unique across subfolders. Rename duplicate files and try again."); return; }
      names.add(file.name);
    }
    const uploadedNames = new Set(images.map((image) => image.filename));
    const supported = candidates.filter((file) => !uploadedNames.has(file.name));
    if (!supported.length) { setProgress("All selected images are already uploaded. Remove an image first to replace it."); return; }
    if (images.length + supported.length > MAX_COLLECTION_IMAGES) { setError(`A collection can contain up to ${MAX_COLLECTION_IMAGES} images. Remove images or choose a smaller folder.`); return; }
    if (supported.some((file) => !file.size || file.size > maxImageBytes) || supported.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) { setError("Use images up to 4 MB each and up to 100 MB per selection."); return; }
    const abort = new AbortController(); controller.current = abort; onBusy(true);
    const completed = [...images];
    try {
      for (let index = 0; index < supported.length; index++) {
        const file = supported[index]; setProgress(`Uploading ${index + 1} of ${supported.length}: ${file.name}`);
        let url: string;
        if (preview) { url = URL.createObjectURL(file); localUrls.current.push(url); }
        else {
          const mime = /\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg";
          const body = new FormData(); body.append("file", new File([file], file.name, { type: mime })); body.append("itemType", "NFT");
          const response = await fetch("/api/uploads", { method: "POST", headers, body, signal: abort.signal });
          const data = await response.json();
          if (!response.ok) throw new Error(`${file.name}: ${data.error || "Upload failed. Choose the remaining files to retry."}`);
          if (typeof data.url !== "string" || !/^\/api\/uploads\/[a-z0-9]{20,40}$/.test(data.url)) throw new Error("The upload returned an invalid image URL.");
          url = data.url;
        }
        if (abort.signal.aborted) break;
        completed.push({ imageUrl: url, filename: file.name }); onChange([...completed]);
      }
      setProgress(`${completed.length} images ready. Non-image files were skipped.`);
    } catch (cause) { if (!abort.signal.aborted) setError(`${(cause as Error).message} Completed uploads have been kept.`); }
    finally { if (abort.signal.aborted) setProgress(`Upload stopped. ${completed.length} completed images have been kept.`); onBusy(false); controller.current = null; if (files.current) files.current.value = ""; if (folder.current) folder.current.value = ""; }
  }
  function move(index: number, offset: number) { const next = [...images]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); }
  return <div className="space-y-4 rounded-xl border border-[var(--border-soft)] p-4">
    <p className="text-xs leading-6 text-[var(--muted-text)]">Select a folder or multiple images. Up to 100 images, 4 MB each, 100 MB per selection. Non-image files are skipped. Each image becomes one NFT; the first is your collection cover. Upload order starts by filename, including subfolders.</p>
    <input ref={files} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose collection images" className="sr-only" disabled={busy} onChange={(event) => void upload(event.target.files)} />
    <input ref={folder} type="file" multiple {...({ webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>)} aria-label="Choose collection folder" className="sr-only" disabled={busy} onChange={(event) => void upload(event.target.files)} />
    <div className="flex flex-wrap gap-3"><button type="button" className={action} disabled={busy} onClick={() => folder.current?.click()}>Choose folder</button><button type="button" className={action} disabled={busy} onClick={() => files.current?.click()}>Choose multiple images</button>{busy && <button type="button" className={action} onClick={() => controller.current?.abort()}>Stop upload</button>}</div>
    {progress && <p role="status" className="text-xs">{progress}</p>}{error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    {!!images.length && <><p className="text-xs font-semibold">{images.length} images · token order</p><div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2">{images.map((image, index) => <div key={image.imageUrl} className="rounded-xl border border-[var(--border-soft)] p-3"><div className="relative aspect-square overflow-hidden rounded-lg"><Image src={image.imageUrl} alt={image.filename} fill unoptimized sizes="180px" className="object-cover" /></div><p className="mt-2 truncate text-xs">#{index + 1} · {image.filename}{index === 0 ? " · Cover" : ""}</p><div className="mt-2 flex gap-2 text-xs"><button type="button" disabled={busy || index === 0} aria-label={`Move ${image.filename} earlier`} onClick={() => move(index, -1)} className="rounded border px-2 py-1 disabled:opacity-30">↑</button><button type="button" disabled={busy || index === images.length - 1} aria-label={`Move ${image.filename} later`} onClick={() => move(index, 1)} className="rounded border px-2 py-1 disabled:opacity-30">↓</button><button type="button" disabled={busy} onClick={() => onChange(images.filter((_, row) => row !== index))} className="ml-auto text-rose-500 disabled:opacity-30">Remove</button></div></div>)}</div></>}
  </div>;
}
