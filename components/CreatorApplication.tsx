"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, CheckCircle2, Clock3, ExternalLink, ImagePlus, Layers3, LoaderCircle, LockKeyhole, Palette, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import Atmosphere from "@/components/Atmosphere";
import ArticLogo from "@/components/ArticLogo";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import CollectionFolderUpload from "@/components/CollectionFolderUpload";
import type { CollectionImageInput } from "@/lib/collectionImages";
import { useArtiqAccount } from "@/hooks/useArtiqAccount";
import { NFT_KINDS, NFT_KIND_INFO, type NftKind } from "@/lib/nftTypes";

type ItemType = "NFT" | "WEB2_ART";
type CreationMethod = "HUMAN" | "AI_GENERATED" | "AI_ASSISTED";
type ImageScreening = {
  status: "FLAGGED" | "REVIEW_REQUIRED";
  summary: string;
  signals: { code: string; label: string }[];
  provider?: { name: "sightengine"; status: "COMPLETED" | "NOT_CONFIGURED" | "ERROR" };
};
type Application = {
  id: string;
  title: string;
  itemType: ItemType;
  imageUrl: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote?: string | null;
  createdAt: string;
  itemId?: string | null;
  screening?: ImageScreening | null;
  nftKind?: NftKind | null;
};

const inputClass = "min-w-0 w-full rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm text-[var(--page-text)] outline-none transition placeholder:text-[var(--faint-text)] focus:border-[#b55fbe] focus:ring-2 focus:ring-[#b55fbe]/15 disabled:opacity-60";
const labelClass = "mb-2 block text-sm font-semibold text-[var(--page-text)]";
const smallButton = "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2 text-xs font-semibold transition hover:bg-[var(--chip-bg)] disabled:cursor-not-allowed disabled:opacity-50";
const initialFields = { creatorName: "", contactEmail: "", title: "", description: "", priceUsdc: "", maxSupply: "1", mintStartTime: "", contractAddress: "", category: "PAINTING", symbol: "ARTIQ", maxPerWallet: "1", royaltyPercent: "0", metadataUri: "" };
const nftKindIcons = { COLLECTIBLE: Sparkles, EDITION: Layers3, SOULBOUND: LockKeyhole, MEMBERSHIP: BadgeCheck };

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(response.ok ? "The server returned an unreadable response. Please try again." : "The service is temporarily unavailable. Please try again.", response.status);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new RequestError("The server returned an unreadable response. Please try again.", response.status);
  const data = result as Record<string, unknown>;
  if (!response.ok) {
    throw new RequestError(typeof data.error === "string" ? data.error : `The request could not be completed (${response.status}). Please try again.`, response.status);
  }
  return data;
}

function isValidImageUrl(value: string) {
  if (/^\/api\/uploads\/[a-zA-Z0-9._-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  } catch {
    return false;
  }
}

function readScreening(value: unknown): ImageScreening | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Record<string, unknown>;
  if (report.status !== "FLAGGED" && report.status !== "REVIEW_REQUIRED") return null;
  const signals = Array.isArray(report.signals) ? report.signals.flatMap((signal: unknown) => {
    if (!signal || typeof signal !== "object") return [];
    const item = signal as Record<string, unknown>;
    return typeof item.code === "string" && typeof item.label === "string" ? [{ code: item.code, label: item.label }] : [];
  }) : [];
  const provider = report.provider && typeof report.provider === "object" ? report.provider as Record<string, unknown> : null;
  const imageProvider: ImageScreening["provider"] = provider?.name === "sightengine" && (provider.status === "COMPLETED" || provider.status === "NOT_CONFIGURED" || provider.status === "ERROR") ? { name: "sightengine", status: provider.status } : undefined;
  return {
    status: report.status,
    summary: typeof report.summary === "string" ? report.summary : "A reviewer will assess your artwork and creation details.",
    signals,
    ...(imageProvider ? { provider: imageProvider } : {}),
  };
}

function ScreeningReport({ report, itemType }: { report: ImageScreening | null; itemType: ItemType }) {
  const flagged = report?.status === "FLAGGED";
  return (
    <div role="status" className={`mt-4 rounded-xl border p-4 ${flagged ? "border-amber-500/30 bg-amber-500/5" : "border-[#b55fbe]/25 bg-[#b55fbe]/5"}`}>
      <div className="flex items-start gap-2.5">
        <Clock3 size={17} className="mt-0.5 shrink-0 text-[#b55fbe]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{flagged ? "Possible AI signals need a closer look" : "Human review is still required"}</p>
          <p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">{report?.summary || "Screening details are unavailable. A reviewer will assess your artwork and creation details."}</p>
          {!!report?.signals.length && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--muted-text)]">{report.signals.map((signal, index) => <li key={`${signal.code}:${index}`}>{signal.label}</li>)}</ul>}
          <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{report?.provider?.status === "COMPLETED" ? "Optional image analysis was completed by Sightengine." : report?.provider?.status === "ERROR" ? "Optional image analysis was unavailable. Your application can still be reviewed." : report?.provider?.status === "NOT_CONFIGURED" ? "Pixel-level AI analysis was not run. The optional image analysis service is not configured or enabled." : "No pixel-analysis result is available in this report."}</p>
          <p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">{itemType === "NFT" ? "AI-generated and AI-assisted NFTs are welcome. These signals do not restrict NFT applications." : flagged ? "These signals are not proof of AI generation. You can still submit your work for manual review; the team will consider your creation process." : "A report without flags does not confirm human authorship. The team reviews your declaration and creation process before approval."}</p>
        </div>
      </div>
    </div>
  );
}

function ApplicationStatus({ status }: { status: Application["status"] }) {
  const styles = {
    PENDING: "border-[#b55fbe]/25 bg-[#b55fbe]/10 text-[var(--page-text)]",
    APPROVED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    REJECTED: "border-[#EF476F]/25 bg-[#EF476F]/10 text-[#d73c63] dark:text-[#ff8eab]",
  };
  const Icon = status === "APPROVED" ? CheckCircle2 : status === "REJECTED" ? X : Clock3;
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}><Icon size={12} aria-hidden="true" />{status === "PENDING" ? "Pending review" : status === "APPROVED" ? "Approved" : "Not approved"}</span>;
}

function SubmissionForm({ walletAddress, accountId, initialItemType, initialNftKind = "COLLECTIBLE", onSessionExpired, preview = false }: { walletAddress?: string; accountId?: string; initialItemType: ItemType; initialNftKind?: NftKind; onSessionExpired?: () => void; preview?: boolean }) {
  const queryClient = useQueryClient();
  const [itemType, setItemType] = useState<ItemType>(initialItemType);
  const [fields, setFields] = useState(initialFields);
  const [nftKind, setNftKind] = useState<NftKind>(initialNftKind);
  const [attributes, setAttributes] = useState<{ trait_type: string; value: string }[]>([]);
  const [imageSource, setImageSource] = useState<"upload" | "url" | "series">("upload");
  const [seriesImages, setSeriesImages] = useState<CollectionImageInput[]>([]);
  const [imageLink, setImageLink] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [uploadedName, setUploadedName] = useState("");
  const [screening, setScreening] = useState<ImageScreening | null>(null);
  const [creationMethod, setCreationMethod] = useState<CreationMethod>("HUMAN");
  const [humanMadeDeclaration, setHumanMadeDeclaration] = useState(false);
  const [creationProcess, setCreationProcess] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [receipt, setReceipt] = useState<Application | null>(null);
  const [previewApplications, setPreviewApplications] = useState<Application[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewImages = useRef<string[]>([]);
  useEffect(() => {
    const images = previewImages.current;
    return () => { images.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);
  const activeImageSource = itemType === "WEB2_ART" ? "upload" : imageSource;
  const imageUrl = activeImageSource === "series" ? seriesImages[0]?.imageUrl || "" : activeImageSource === "upload" ? uploadedUrl : imageLink.trim();
  const previewUrl = isValidImageUrl(imageUrl) || (preview && (previewImages.current.includes(imageUrl) || seriesImages.some((image) => image.imageUrl === imageUrl))) ? imageUrl : "";
  const busy = isUploading || isSubmitting;
  const identity = accountId ? `email:${accountId}` : walletAddress ? `wallet:${walletAddress.toLowerCase()}` : undefined;
  const authHeaders: Record<string, string> = accountId ? { "X-Artiq-Account-ID": accountId } : walletAddress ? { "X-Wallet-Address": walletAddress } : {};

  const applications = useQuery({
    queryKey: ["submissions", preview ? "local-preview" : identity],
    enabled: !preview && !!identity,
    queryFn: async ({ signal }): Promise<Application[]> => {
      if (preview || !identity) return [];
      const response = await fetch("/api/submissions", { cache: "no-store", headers: authHeaders, signal });
      if (response.status === 401) onSessionExpired?.();
      const data = await readResponse(response);
      if (!Array.isArray(data.submissions)) throw new Error("We couldn’t read your applications. Please try again.");
      return data.submissions as Application[];
    },
    staleTime: 15_000,
    refetchInterval: preview ? false : 30_000,
    retry: 1,
  });
  const displayedApplications = preview ? previewApplications : applications.data;

  function updateField(name: keyof typeof initialFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
    setSubmitError("");
  }

  function updateSeries(images: CollectionImageInput[]) {
    setSeriesImages(images);
    setFields((current) => ({ ...current, maxSupply: String(images.length || 1), maxPerWallet: String(Math.min(Number(current.maxPerWallet) || 1, images.length || 1)), metadataUri: "", contractAddress: "" }));
    setSubmitError("");
  }

  async function uploadImage(file: File | undefined) {
    if (!file || busy) return;
    setUploadError("");
    setUploadedUrl("");
    setUploadedName("");
    setScreening(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setUploadError("Choose a PNG, JPEG, or WebP image.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Your image must be 5 MB or smaller.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("itemType", itemType);
      const result = await readResponse(await fetch(preview ? "/api/preview/screen" : "/api/uploads", { method: "POST", ...(!preview ? { headers: authHeaders } : {}), body }));
      if (preview) {
        const url = URL.createObjectURL(file);
        previewImages.current.push(url);
        setUploadedUrl(url);
      } else {
        if (typeof result.url !== "string" || !isValidImageUrl(result.url)) throw new Error("The image upload returned an invalid link. Please try again.");
        setUploadedUrl(result.url);
      }
      setUploadedName(file.name);
      setScreening(readScreening(result.screening));
      setSubmitError("");
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) onSessionExpired?.();
      setUploadError(error instanceof Error ? error.message : "Your image couldn’t be uploaded. Please try again.");
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSubmitError("");
    if (itemType === "NFT" && activeImageSource === "series" && seriesImages.length > 1 && nftKind === "EDITION") {
      setSubmitError("Editions share one image. Choose Collectible for an image series."); return;
    }
    if (!previewUrl) {
      setSubmitError(activeImageSource === "upload" ? "Upload an image of your work before submitting." : "Add a valid HTTPS image URL before submitting.");
      return;
    }
    if (itemType === "WEB2_ART" && !humanMadeDeclaration) {
      setSubmitError("Confirm that you created this artwork without generative AI before submitting.");
      return;
    }
    if (itemType === "WEB2_ART" && (creationProcess.trim().length < 30 || creationProcess.trim().length > 2000)) {
      setSubmitError("Describe how you made this artwork in 30 to 2,000 characters, including your materials, process, or supporting proof.");
      return;
    }
    const price = fields.priceUsdc.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(price) || Number(price) < (itemType === "NFT" ? 0 : 0.000001) || Number(price) > 1_000_000) {
      setSubmitError(`Enter a USDC price from ${itemType === "NFT" ? "0" : "0.000001"} to 1,000,000, with up to 6 decimal places.`);
      return;
    }
    if (itemType === "NFT" && (!/^\d+$/.test(fields.maxSupply) || Number(fields.maxSupply) < 1 || Number(fields.maxSupply) > 1_000_000)) {
      setSubmitError("Edition size must be a whole number from 1 to 1,000,000.");
      return;
    }
    if (itemType === "NFT" && fields.contractAddress.trim() && !/^0x[a-fA-F0-9]{40}$/.test(fields.contractAddress.trim())) {
      setSubmitError("Enter a valid 0x contract address, or leave it empty.");
      return;
    }
    if (itemType === "NFT") {
      if (!/^[A-Z][A-Z0-9]{2,9}$/.test(fields.symbol.trim())) { setSubmitError("Use a collection symbol with 3–10 uppercase letters or numbers, starting with a letter."); return; }
      if (!/^\d+$/.test(fields.maxPerWallet) || Number(fields.maxPerWallet) < 1 || Number(fields.maxPerWallet) > Number(fields.maxSupply)) { setSubmitError("The per-wallet limit must be a whole number between 1 and your collection supply."); return; }
      if (!/^\d+(\.\d{1,2})?$/.test(fields.royaltyPercent) || Number(fields.royaltyPercent) > 10) { setSubmitError("Royalties must be between 0% and 10%, with up to two decimal places."); return; }
      if (fields.metadataUri.trim()) {
        try { const uri = new URL(fields.metadataUri.trim()); if (!["https:", "ipfs:"].includes(uri.protocol) || !uri.hostname || uri.username || uri.password) throw new Error(); } catch { setSubmitError("Add an HTTPS or IPFS link to your metadata JSON."); return; }
      }
      if (attributes.some((trait) => !trait.trait_type.trim() || !trait.value.trim())) { setSubmitError("Give every trait a name and value, or remove the empty trait."); return; }
    }
    let mintStartTime: string | undefined;
    if (itemType === "NFT" && fields.mintStartTime) {
      const date = new Date(fields.mintStartTime);
      if (Number.isNaN(date.getTime())) { setSubmitError("Choose a valid mint start date and time."); return; }
      mintStartTime = date.toISOString();
    }
    if (!fields.creatorName.trim() || !fields.title.trim() || !fields.description.trim()) {
      setSubmitError("Add your creator name, artwork title, and description.");
      return;
    }
    setIsSubmitting(true);
    try {
      const body = {
        itemType,
        creatorName: fields.creatorName.trim(),
        contactEmail: fields.contactEmail.trim() || undefined,
        title: fields.title.trim(),
        description: fields.description.trim(),
        imageUrl,
        ...(itemType === "NFT" && activeImageSource === "series" ? { images: seriesImages } : {}),
        priceUsdc: price,
        ...(itemType === "NFT" ? { nftKind, symbol: fields.symbol.trim(), maxSupply: Number(fields.maxSupply), maxPerWallet: Number(fields.maxPerWallet), royaltyBps: nftKind === "SOULBOUND" ? 0 : Math.round(Number(fields.royaltyPercent) * 100), metadataUri: fields.metadataUri.trim() || undefined, attributes: attributes.map((trait) => ({ trait_type: trait.trait_type.trim(), value: trait.value.trim() })), mintStartTime, contractAddress: fields.contractAddress.trim() || undefined, creationMethod } : { category: fields.category, creationMethod: "HUMAN", humanMadeDeclaration: true, creationProcess: creationProcess.trim() }),
      };
      let submission: Application | undefined;
      if (preview) {
        submission = { id: `preview-${crypto.randomUUID()}`, title: body.title, itemType, ...(itemType === "NFT" ? { nftKind } : {}), imageUrl, status: "PENDING", createdAt: new Date().toISOString(), screening };
        setPreviewApplications((current) => [submission!, ...current]);
      } else {
        if (!identity) throw new Error("Sign in with email or a wallet before submitting.");
        const result = await readResponse(await fetch("/api/submissions", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(body) }));
        submission = result.submission as Application | undefined;
      }
      if (!submission || typeof submission.id !== "string" || typeof submission.title !== "string") throw new Error("We couldn’t confirm the submission. Refresh your applications before trying again.");
      setReceipt(submission);
      setFields(initialFields);
      setAttributes([]);
      setImageLink("");
      setUploadedUrl("");
      setUploadedName("");
      setSeriesImages([]);
      setScreening(null);
      setCreationMethod("HUMAN");
      setHumanMadeDeclaration(false);
      setCreationProcess("");
      setUploadError("");
      if (fileRef.current) fileRef.current.value = "";
      if (!preview) {
        void queryClient.invalidateQueries({ queryKey: ["submissions", identity] });
        void queryClient.invalidateQueries({ queryKey: ["items"] });
      }
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) onSessionExpired?.();
      setSubmitError(error instanceof Error ? error.message : "Your application couldn’t be submitted. Your details are still here, so you can try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-w-0 space-y-7">
      {receipt && <div role="status" className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" size={23} aria-hidden="true" /><div className="min-w-0 flex-1"><h2 className="text-lg">{preview ? "Your preview is ready." : "Your work is in good hands."}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">{preview ? `“${receipt.title}” is a temporary preview in this tab. It has not been submitted for review or published.` : `“${receipt.title}” was submitted for review. It will appear in the marketplace after approval.`}</p><p className="mt-3 break-all text-xs text-[var(--faint-text)]">{preview ? "Preview ID" : "Application ID"}: {receipt.id}</p><a href="#my-applications" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold">{preview ? "View preview history" : "Track your application"} <ArrowRight size={14} /></a></div><button type="button" aria-label="Dismiss submission receipt" onClick={() => setReceipt(null)} className="rounded-full p-1 hover:bg-[var(--chip-bg)]"><X size={16} /></button></div></div>}

      <section className="gallery-card p-5 sm:p-8" aria-labelledby="application-heading">
        <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#b55fbe]/10 text-[#b55fbe]"><Palette size={20} aria-hidden="true" /></span><div><h2 id="application-heading" className="text-xl">Tell us about your work</h2><p className="mt-1 text-xs text-[var(--muted-text)]">One application per artwork or NFT collection.</p></div></div>
        <form onSubmit={submitApplication} className="mt-7 space-y-6">
          <fieldset disabled={busy} className="space-y-6 disabled:opacity-75">
            <div><span id="artwork-type-label" className={labelClass}>What are you submitting?</span><div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="artwork-type-label">{([{ value: "NFT", label: "NFT collection", note: "Digital editions", Icon: Sparkles }, { value: "WEB2_ART", label: "Original art", note: "Art & creative objects", Icon: Palette }] as const).map(({ value, label, note, Icon }) => <button key={value} type="button" aria-pressed={itemType === value} onClick={() => { if (preview && value !== itemType) { setUploadedUrl(""); setUploadedName(""); setScreening(null); } setItemType(value); setSubmitError(""); }} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition sm:p-4 ${itemType === value ? "border-[#b55fbe] bg-[#b55fbe]/10" : "border-[var(--border-soft)] hover:bg-[var(--chip-bg)]"}`}><Icon size={20} className="hidden shrink-0 text-[#b55fbe] min-[380px]:block" aria-hidden="true" /><span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-[11px] text-[var(--muted-text)]">{note}</span></span>{itemType === value && <Check size={15} className="ml-auto shrink-0 text-[#b55fbe]" aria-hidden="true" />}</button>)}</div></div>

            {itemType === "NFT" && <section aria-labelledby="nft-kind-heading"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 id="nft-kind-heading" className="text-sm font-semibold">Choose your NFT format</h3><span className="text-[10px] text-[var(--faint-text)]">Four ways to make it yours</span></div><div className="grid gap-3 sm:grid-cols-2" role="group" aria-labelledby="nft-kind-heading">{NFT_KINDS.map((kind) => { const info = NFT_KIND_INFO[kind]; const Icon = nftKindIcons[kind]; return <button type="button" key={kind} aria-pressed={nftKind === kind} onClick={() => { setNftKind(kind); if (kind === "SOULBOUND") updateField("royaltyPercent", "0"); setSubmitError(""); }} className={`relative rounded-2xl border p-4 text-left transition ${nftKind === kind ? "border-[#b55fbe] bg-[#b55fbe]/10" : "border-[var(--border-soft)] hover:bg-[var(--chip-bg)]"}`}><div className="flex items-center gap-2"><Icon size={18} className="text-[#b55fbe]" aria-hidden="true" /><span className="text-sm font-semibold">{info.label}</span>{nftKind === kind && <Check size={14} className="ml-auto text-[#b55fbe]" aria-hidden="true" />}</div><p className="mt-2 text-[11px] leading-5 text-[var(--muted-text)]">{info.description}</p><span className="mt-3 inline-block rounded-full border border-[var(--border-soft)] px-2 py-1 font-mono text-[9px]">{info.standard} · {info.transferable ? "Transferable" : "Bound to its holder"}</span></button>; })}</div>{nftKind === "SOULBOUND" && <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#b55fbe]/5 p-3 text-xs leading-6 text-[var(--muted-text)]"><LockKeyhole size={15} className="mt-1 shrink-0 text-[#b55fbe]" aria-hidden="true" />Soulbound tokens stay with the wallet that mints them. Transfers and resale are disabled; royalties are set to zero.</p>}{nftKind === "MEMBERSHIP" && <p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Describe the access or benefits you provide. This pass does not automatically manage a community, subscriptions, or expiry.</p>}</section>}

            <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="creator-name" className={labelClass}>Creator name <span className="text-[#EF476F]">*</span></label><input id="creator-name" name="creatorName" autoComplete="nickname" required maxLength={80} value={fields.creatorName} onChange={(event) => updateField("creatorName", event.target.value)} placeholder="Your artist name" className={inputClass} /></div><div><label htmlFor="contact-email" className={labelClass}>Email <span className="font-normal text-[var(--faint-text)]">(optional)</span></label><input id="contact-email" name="contactEmail" type="email" autoComplete="email" maxLength={254} value={fields.contactEmail} onChange={(event) => updateField("contactEmail", event.target.value)} placeholder="you@example.com" aria-describedby="contact-email-hint" className={inputClass} /><p id="contact-email-hint" className="mt-2 text-[11px] text-[var(--faint-text)]">Private. Only used if we need to contact you.</p></div></div>

            <div><label htmlFor="art-title" className={labelClass}>{itemType === "NFT" ? "Collection title" : "Artwork title"} <span className="text-[#EF476F]">*</span></label><input id="art-title" name="title" required maxLength={120} value={fields.title} onChange={(event) => updateField("title", event.target.value)} placeholder="Give your work a name" className={inputClass} /></div>
            <div><label htmlFor="art-description" className={labelClass}>The story behind it <span className="text-[#EF476F]">*</span></label><textarea id="art-description" name="description" required maxLength={4000} rows={5} value={fields.description} onChange={(event) => updateField("description", event.target.value)} placeholder="Tell us what inspired this work, how it was made, and what makes it yours." className={`${inputClass} resize-y`} /><p className="mt-2 text-right text-[11px] text-[var(--faint-text)]">{fields.description.length.toLocaleString()} / 4,000</p></div>

            {itemType === "WEB2_ART" ? (
              <section className="rounded-2xl border border-[#b55fbe]/25 bg-[#b55fbe]/5 p-5" aria-labelledby="original-art-policy">
                <h3 id="original-art-policy" className="text-sm">Original Art is made by people.</h3>
                <p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">Generative AI images are not accepted in Original Art. Upload your artwork and explain how you made it so our team can review its authorship.</p>
                <label htmlFor="creation-process" className={`${labelClass} mt-5`}>How did you create this work? <span className="text-[#EF476F]">*</span></label>
                <textarea id="creation-process" name="creationProcess" required minLength={30} maxLength={2000} rows={4} value={creationProcess} onChange={(event) => { setCreationProcess(event.target.value); setSubmitError(""); }} aria-describedby="creation-process-help" placeholder="Describe your materials, tools, and steps. Include details about sketches, work-in-progress photos, or other proof you can share with the reviewer." className={`${inputClass} resize-y`} />
                <div id="creation-process-help" className="mt-2 flex flex-wrap justify-between gap-2 text-[11px] text-[var(--faint-text)]"><span>30–2,000 characters. Share your own process.</span><span>{creationProcess.length.toLocaleString()} / 2,000</span></div>
                <label htmlFor="human-made-declaration" className="mt-5 flex cursor-pointer items-start gap-3 text-sm font-semibold leading-6"><input id="human-made-declaration" name="humanMadeDeclaration" type="checkbox" required checked={humanMadeDeclaration} onChange={(event) => { setHumanMadeDeclaration(event.target.checked); setSubmitError(""); }} className="mt-1 h-4 w-4 shrink-0 accent-[#b55fbe]" />I created this artwork without generative AI.</label>
                <p className="mt-4 text-xs leading-6 text-[var(--muted-text)]">All Original Art applications receive manual review. Automated screening can miss AI images or flag human-made work, so it cannot prove authorship. Images may be screened by Sightengine when that optional service is enabled.</p>
              </section>
            ) : (
              <div>
                <label htmlFor="creation-method" className={labelClass}>Creation method <span className="font-normal text-[var(--faint-text)]">(optional)</span></label>
                <select id="creation-method" name="creationMethod" value={creationMethod} onChange={(event) => { setCreationMethod(event.target.value as CreationMethod); setSubmitError(""); }} aria-describedby="nft-creation-help" className={inputClass}>
                  <option value="HUMAN">Human-made</option><option value="AI_GENERATED">AI-generated</option><option value="AI_ASSISTED">AI-assisted</option>
                </select>
                <p id="nft-creation-help" className="mt-2 text-xs leading-6 text-[var(--muted-text)]">AI-generated and AI-assisted NFTs are welcome. Choose the method that best describes your collection.</p>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={labelClass}>Artwork image <span className="text-[#EF476F]">*</span></span>
                {itemType === "NFT" && <div className="mb-2 inline-flex rounded-full border border-[var(--border-soft)] p-0.5" role="group" aria-label="Image source">{(["upload", "series", "url"] as const).map((source) => <button key={source} type="button" onClick={() => { setImageSource(source); if (source !== "series") setSeriesImages([]); setSubmitError(""); }} aria-pressed={activeImageSource === source} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${activeImageSource === source ? "bg-[#b55fbe]/15" : "text-[var(--muted-text)]"}`}>{source === "upload" ? "Single image" : source === "series" ? "Folder / series" : "Image URL"}</button>)}</div>}
              </div>
              {itemType === "WEB2_ART" && <p className="mb-3 text-xs leading-6 text-[var(--muted-text)]">Upload the image file for review. External image URLs are available for NFT applications.</p>}
              {itemType === "NFT" && activeImageSource === "upload" && <p className="mb-3 text-xs leading-6 text-[var(--muted-text)]">NFT uploads receive metadata checks only. They are not sent to Sightengine. AI-generated NFTs remain welcome.</p>}
              {activeImageSource === "series" ? <CollectionFolderUpload images={seriesImages} onChange={updateSeries} headers={authHeaders} busy={busy} onBusy={setIsUploading} preview={preview} /> : activeImageSource === "upload" ? (
                <div className="rounded-2xl border border-dashed border-[#b55fbe]/40 bg-[#b55fbe]/5 p-6 text-center">
                  <input ref={fileRef} type="file" id="art-image" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(event) => void uploadImage(event.target.files?.[0])} />
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--card-bg)] text-[#b55fbe]">{isUploading ? <LoaderCircle size={23} className="animate-spin" /> : uploadedUrl ? <CheckCircle2 size={23} /> : <Upload size={23} />}</div>
                  <p className="mt-3 break-words text-sm font-semibold">{isUploading ? "Uploading your image…" : uploadedName || "Give your work the spotlight"}</p>
                  <p className="mt-2 text-xs text-[var(--muted-text)]">PNG, JPEG, or WebP · Up to 5 MB</p>
                  <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={`${smallButton} mt-4`}>{uploadedUrl ? "Replace image" : uploadError ? "Try another image" : "Choose image"}<ImagePlus size={14} aria-hidden="true" /></button>
                </div>
              ) : (
                <div><label htmlFor="image-url" className="sr-only">HTTPS image URL</label><input id="image-url" name="imageUrl" type="url" inputMode="url" required value={imageLink} maxLength={2048} onChange={(event) => { setImageLink(event.target.value); setSubmitError(""); }} placeholder="https://example.com/your-artwork.jpg" className={inputClass} /><p className="mt-2 text-[11px] leading-5 text-[var(--faint-text)]">Use a public HTTPS link that opens the image directly.</p></div>
              )}
              {uploadError && activeImageSource === "upload" && <p role="alert" className="mt-3 text-sm text-[#d73c63] dark:text-[#ff8eab]">{uploadError}</p>}
              {previewUrl && <div className="mt-4 flex gap-4 rounded-xl border border-[var(--border-soft)] p-3"><div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--chip-bg)]"><Image key={previewUrl} src={previewUrl} alt="Your artwork preview" fill unoptimized sizes="80px" className="object-cover" /></div><div className="min-w-0 self-center"><p className="text-xs font-semibold">Image preview</p><p className="mt-1 text-[11px] leading-5 text-[var(--muted-text)]">{preview ? "This image is held temporarily in this tab for your preview." : "This image will represent your work in the marketplace."}</p></div></div>}
              {previewUrl && activeImageSource === "upload" && <ScreeningReport report={screening} itemType={itemType} />}
            </div>

            <div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="art-price" className={labelClass}>{itemType === "NFT" ? "Mint price" : "Asking price"} <span className="text-[#EF476F]">*</span></label><div className="relative"><input id="art-price" name="priceUsdc" type="number" inputMode="decimal" required min={itemType === "NFT" ? "0" : "0.000001"} max="1000000" step="0.000001" value={fields.priceUsdc} onChange={(event) => updateField("priceUsdc", event.target.value)} placeholder="0.00" className={`${inputClass} pr-20`} /><span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-[var(--muted-text)]">USDC</span></div><p className="mt-2 text-[11px] text-[var(--faint-text)]">{itemType === "NFT" ? "Use 0 for a free mint. Network gas still applies." : "Test USDC during the Arc Testnet pilot."}</p></div>{itemType === "NFT" ? <div><label htmlFor="max-supply" className={labelClass}>Collection supply <span className="text-[#EF476F]">*</span></label><input id="max-supply" readOnly={activeImageSource === "series"} name="maxSupply" type="number" inputMode="numeric" required min={1} max={1000000} step={1} value={fields.maxSupply} onChange={(event) => updateField("maxSupply", event.target.value)} className={inputClass} /><p className="mt-2 text-[11px] text-[var(--faint-text)]">Total tokens available. Editions use copies of one token ID.</p></div> : <div><label htmlFor="art-category" className={labelClass}>Category <span className="text-[#EF476F]">*</span></label><select id="art-category" name="category" value={fields.category} onChange={(event) => updateField("category", event.target.value)} className={inputClass}><option value="PAINTING">Painting</option><option value="RUG">Artistic rug</option><option value="COSMETIC">Artistic cosmetic</option><option value="OTHER">Other</option></select></div>}</div>

            {itemType === "NFT" && <section className="space-y-5 rounded-2xl border border-[var(--border-soft)] p-4 sm:p-5" aria-labelledby="collection-settings-heading"><div><h3 id="collection-settings-heading" className="text-sm font-semibold">Collection settings</h3><p className="mt-1 text-xs leading-6 text-[var(--muted-text)]">Set the mint rules before your collection goes onchain.</p></div><div className="grid gap-5 sm:grid-cols-2"><div><label htmlFor="nft-symbol" className={labelClass}>Collection symbol</label><input id="nft-symbol" name="symbol" required minLength={3} maxLength={10} pattern="[A-Z][A-Z0-9]{2,9}" value={fields.symbol} onChange={(event) => updateField("symbol", event.target.value.toUpperCase())} className={inputClass} /><p className="mt-2 text-[11px] text-[var(--faint-text)]">3–10 uppercase letters or numbers.</p></div><div><label htmlFor="max-per-wallet" className={labelClass}>Mint limit per wallet</label><input id="max-per-wallet" name="maxPerWallet" type="number" inputMode="numeric" required min={1} max={Number(fields.maxSupply) || 1} step={1} value={fields.maxPerWallet} onChange={(event) => updateField("maxPerWallet", event.target.value)} className={inputClass} /></div></div><div><label htmlFor="nft-royalty" className={labelClass}>Creator royalty (%)</label><input id="nft-royalty" name="royaltyPercent" type="number" inputMode="decimal" required min={0} max={10} step="0.01" disabled={nftKind === "SOULBOUND"} value={nftKind === "SOULBOUND" ? "0" : fields.royaltyPercent} onChange={(event) => updateField("royaltyPercent", event.target.value)} className={inputClass} /><p className="mt-2 text-[11px] leading-5 text-[var(--faint-text)]">{nftKind === "SOULBOUND" ? "Soulbound tokens cannot be resold, so royalties are disabled." : "0–10%. ERC-2981 royalties are a signal to compatible marketplaces; resale payments are not guaranteed."}</p></div><div><label htmlFor="nft-metadata" className={labelClass}>Metadata JSON URI <span className="font-normal text-[var(--faint-text)]">(optional)</span></label><input id="nft-metadata" disabled={activeImageSource === "series"} name="metadataUri" maxLength={2048} value={fields.metadataUri} onChange={(event) => updateField("metadataUri", event.target.value)} placeholder="ipfs://…/metadata.json or https://…" className={inputClass} /><p className="mt-2 text-[11px] leading-5 text-[var(--faint-text)]">Use public HTTPS or IPFS metadata. Adding a link does not upload or pin files.</p></div><div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><label className="text-sm font-semibold" id="traits-heading">Traits <span className="font-normal text-[var(--faint-text)]">(optional)</span></label><button type="button" disabled={attributes.length >= 20} onClick={() => setAttributes((current) => [...current, { trait_type: "", value: "" }])} className={smallButton}><Plus size={12} aria-hidden="true" />Add trait</button></div><div className="space-y-2" role="group" aria-labelledby="traits-heading">{attributes.map((trait, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2"><input aria-label={`Trait ${index + 1} name`} maxLength={60} placeholder="Trait, e.g. Palette" value={trait.trait_type} onChange={(event) => setAttributes((current) => current.map((entry, row) => row === index ? { ...entry, trait_type: event.target.value } : entry))} className={inputClass} /><input aria-label={`Trait ${index + 1} value`} maxLength={120} placeholder="Value, e.g. Lavender" value={trait.value} onChange={(event) => setAttributes((current) => current.map((entry, row) => row === index ? { ...entry, value: event.target.value } : entry))} className={inputClass} /><button type="button" aria-label={`Remove trait ${index + 1}`} onClick={() => setAttributes((current) => current.filter((_, row) => row !== index))} className="flex w-9 items-center justify-center rounded-xl border border-[var(--border-soft)] hover:bg-[var(--chip-bg)]"><X size={14} /></button></div>)}</div><p className="mt-2 text-[11px] text-[var(--faint-text)]">Up to 20 descriptive traits for this collection.</p></div></section>}

            {itemType === "NFT" && <details className="rounded-xl border border-[var(--border-soft)] p-4"><summary className="cursor-pointer text-sm font-semibold">Schedule & existing contract <span className="font-normal text-[var(--faint-text)]">(optional)</span></summary><div className="mt-5 space-y-5"><div><label htmlFor="mint-start" className={labelClass}>Preferred mint start</label><input id="mint-start" name="mintStartTime" type="datetime-local" value={fields.mintStartTime} onChange={(event) => updateField("mintStartTime", event.target.value)} className={inputClass} /><p className="mt-2 text-[11px] text-[var(--faint-text)]">In your local time. The schedule is subject to review.</p></div><div><label htmlFor="contract-address" className={labelClass}>Existing contract address</label><input id="contract-address" name="contractAddress" maxLength={42} pattern="0x[a-fA-F0-9]{40}" value={fields.contractAddress} onChange={(event) => updateField("contractAddress", event.target.value)} placeholder="0x…" className={inputClass} /><p className="mt-2 text-[11px] text-[var(--faint-text)]">Already deployed on Arc Testnet? Add its address here.</p></div></div></details>}
          </fieldset>

          <div className="border-t border-[var(--border-soft)] pt-6"><p className="text-xs leading-6 text-[var(--muted-text)]">{preview ? "Try the application flow without a wallet. Preview details stay in this tab and disappear when you reload. Original Art images are sent for AI screening when the service is enabled; NFTs receive metadata checks only. Previews are not submitted or published." : "Submit work you created or have permission to share. Every application is reviewed before it can appear in the marketplace. Submitting does not mint an NFT or make a payment."}</p>{submitError && <p role="alert" className="mt-4 rounded-xl border border-[#EF476F]/20 bg-[#EF476F]/5 p-3 text-sm leading-6 text-[#d73c63] dark:text-[#ff8eab]">{submitError}</p>}<button type="submit" disabled={busy} className="gallery-button mt-5 inline-flex w-full items-center justify-center gap-3 px-6 py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}{isSubmitting ? (preview ? "Creating preview…" : "Submitting for review…") : isUploading ? "Checking image…" : preview ? "Create preview" : "Submit for review"}</button></div>
        </form>
      </section>

      <section id="my-applications" className="scroll-mt-24 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-5 sm:p-8" aria-labelledby="my-applications-heading"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--faint-text)]">Your creator space</p><h2 id="my-applications-heading" className="mt-2 text-xl">{preview ? "Preview history" : "My applications"}</h2></div>{!preview && <button type="button" onClick={() => { void applications.refetch(); void queryClient.invalidateQueries({ queryKey: ["items"] }); }} disabled={applications.isFetching} className={smallButton}><RefreshCw size={13} className={applications.isFetching ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>}</div><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">{preview ? "Temporary previews are visible only in this tab and clear when you reload. No reviewer receives them." : "Only you can see your applications here. Review status refreshes automatically."}</p>
        {!preview && applications.isLoading ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-[var(--muted-text)]"><LoaderCircle size={16} className="animate-spin" />Loading your applications…</p> : !preview && applications.isError ? <div role="alert" className="mt-5 rounded-xl bg-[#EF476F]/5 p-4"><p className="text-sm text-[#d73c63] dark:text-[#ff8eab]">{applications.error instanceof Error ? applications.error.message : "Your applications couldn’t be loaded."}</p><button type="button" onClick={() => void applications.refetch()} className={`${smallButton} mt-3`}>Try again</button></div> : displayedApplications?.length ? <div className="mt-6 space-y-3">{displayedApplications.map((application) => <article key={application.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card-bg)] p-4"><div className="flex items-start gap-3">{application.imageUrl && <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--chip-bg)]"><Image src={application.imageUrl} alt="" fill unoptimized sizes="56px" className="object-cover" /></div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold">{application.title}</h3>{preview ? <span className="rounded-full border border-[#b55fbe]/25 bg-[#b55fbe]/10 px-2.5 py-1 text-[11px] font-semibold">Temporary preview</span> : <ApplicationStatus status={application.status} />}</div><p className="mt-2 text-[11px] text-[var(--faint-text)]">{application.itemType === "NFT" ? `${NFT_KIND_INFO[application.nftKind || "COLLECTIBLE"].label} NFT` : "Original art"} · {preview ? "Previewed" : "Submitted"} {new Date(application.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</p>{application.reviewNote && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-[var(--chip-bg)] p-3 text-xs leading-6 text-[var(--muted-text)]"><strong>Reviewer’s note:</strong> {application.reviewNote}</p> }{preview && application.screening && <ScreeningReport report={application.screening} itemType={application.itemType} />}{!preview && application.status === "APPROVED" && <Link href={application.itemId ? (application.itemType === "NFT" ? `/nfts/${application.itemId}` : `/art/${application.itemId}`) : `/marketplace?mode=${application.itemType === "NFT" ? "nft" : "art"}&q=${encodeURIComponent(application.title)}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold">{application.itemType === "NFT" ? "Open collection" : "View artwork"} <ExternalLink size={12} /></Link>}</div></div></article>)}</div> : <div className="mt-6 rounded-xl border border-dashed border-[var(--border-soft)] p-6 text-center"><ImagePlus size={25} className="mx-auto text-[#b55fbe]" aria-hidden="true" /><p className="mt-3 text-sm font-semibold">{preview ? "Your preview history will appear here." : "Your story starts with your first submission."}</p><p className="mt-2 text-xs text-[var(--muted-text)]">{preview ? "Choose an image above to test screening and preview the application flow." : "Submit your work above and follow its progress here."}</p></div>}
      </section>
    </div>
  );
}

function CreatorApplicationGate({ initialItemType, initialNftKind }: { initialItemType: ItemType; initialAuthMethod: "email" | "wallet"; initialNftKind: NftKind }) {
  const account = useArtiqAccount();
  const [signingOut, setSigningOut] = useState(false);
  if (account.isLoading) return <section className="gallery-card flex items-center gap-3 p-6 text-sm text-[var(--muted-text)]" role="status"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" />Checking your sign-in…</section>;
  if (account.user) return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--glass-bg)] p-4"><p className="min-w-0 break-all text-xs leading-6">Signed in as <strong>{account.user.email || account.user.walletAddress || "Artiq creator"}</strong></p><button type="button" disabled={signingOut} onClick={() => { setSigningOut(true); void account.logout().finally(() => setSigningOut(false)); }} className={`${smallButton} shrink-0`}>{signingOut ? "Signing out…" : "Sign out"}</button>{account.error && <p role="alert" className="w-full text-xs leading-6 text-[#d73c63] dark:text-[#ff8eab]">{account.error}</p>}</div><SubmissionForm key={`${account.user.id}:${initialItemType}:${initialNftKind}`} accountId={account.user.id} initialItemType={initialItemType} initialNftKind={initialNftKind} onSessionExpired={() => void account.refresh()} /></div>;
  return <section className="gallery-card p-6 sm:p-9" aria-label="Creator sign-in">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#b55fbe]/10 text-[#b55fbe]"><ShieldCheck size={24} aria-hidden="true" /></div>
    <h2 className="mt-5 text-2xl">Your next creation starts here.</h2>
    <p className="mt-3 max-w-lg text-sm leading-7 text-[var(--muted-text)]">Sign in with email or a wallet to submit your art and manage your collections. Your applications stay together in your Artiq account.</p>
    <div className="mt-6 flex"><ConnectWalletButton /></div>
  </section>;
}

export default function CreatorApplication({ initialItemType, initialAuthMethod = "email", initialNftKind = "COLLECTIBLE", preview = false }: { initialItemType: ItemType; initialAuthMethod?: "email" | "wallet"; initialNftKind?: NftKind; preview?: boolean }) {
  return (
    <main className="gallery-page min-h-screen text-[var(--page-text)]">
      <Atmosphere />
      <header className="gallery-nav top-0 z-30 border-b border-[var(--border-soft)]"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-10"><Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link><div className="flex items-center gap-2 sm:gap-4"><Link href="/nfts" className="text-xs font-semibold">NFTs</Link><Link href="/auctions" className="text-xs font-semibold">Auctions</Link><Link href="/settings" aria-label="Settings" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] hover:bg-[var(--chip-bg)]"><Settings2 size={16} aria-hidden="true" /></Link>{preview ? <span className="rounded-full border border-[#b55fbe]/30 bg-[#b55fbe]/10 px-3 py-2 text-xs font-semibold">Preview mode</span> : <ConnectWalletButton />}</div></div></header>

      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-10 sm:pt-14">
        <Link href="/marketplace" className="mb-6 inline-flex items-center gap-2 text-xs font-semibold sm:hidden"><ArrowLeft size={14} />Back to marketplace</Link>
        <div className="max-w-3xl"><p className="inline-flex items-center gap-2 rounded-full border border-[#b55fbe]/25 bg-[#b55fbe]/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.16em]"><span className="h-1.5 w-1.5 rounded-full bg-[#EF476F]" />Creator applications are open</p><h1 className="mt-5 text-4xl font-semibold leading-[1.12] tracking-tight sm:text-6xl">{initialItemType === "NFT" ? <>Your idea.<br /><span className="hero-word">Your kind of NFT.</span></> : <>Made by you.<br /><span className="hero-word">Discovered on Artiq.</span></>}</h1><p className="mt-5 max-w-xl text-sm leading-7 text-[var(--muted-text)] sm:text-base">{initialItemType === "NFT" ? "Create a collectible, an edition, a soulbound token, or a membership pass. Start with your collection application; connect a wallet when you are ready to deploy on Arc Testnet." : "Give your art a place to be seen. Apply to share your original artwork with the Artiq community."}</p></div>

        {preview && <div role="status" className="mt-7 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm leading-7"><strong>Local preview · No wallet needed.</strong> Test image screening and the application form. Preview applications stay in this tab, clear on reload, and are not submitted or published.</div>}

        <div className="mt-9 grid items-start gap-7 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-9">
          <div className="min-w-0">
            {preview ? <SubmissionForm key={`preview:${initialItemType}:${initialNftKind}`} initialItemType={initialItemType} initialNftKind={initialNftKind} preview /> : <CreatorApplicationGate initialItemType={initialItemType} initialAuthMethod={initialAuthMethod} initialNftKind={initialNftKind} />}
          </div>

          <aside className="space-y-5 lg:sticky lg:top-28"><div className="overflow-hidden rounded-2xl border border-[#b55fbe]/20 bg-[radial-gradient(ellipse_at_top_right,#b55fbe22,transparent_70%)] p-6"><div className="flex items-center gap-2 text-[#b55fbe]"><Sparkles size={18} aria-hidden="true" /><p className="text-[10px] font-semibold uppercase tracking-[.17em]">From studio to spotlight</p></div><h2 className="mt-4 text-xl">A little care.<br />A great collection.</h2><ol className="mt-6 space-y-5">{[{ title: "Share your work", text: "Add your image, story, and the details that make it yours." }, { title: "We take a look", text: "Your work stays out of the marketplace while the Artiq team reviews it." }, { title: "Create your next chapter", text: "Approved NFT collections can be deployed with a wallet. Original art appears in the marketplace." }].map((step, index) => <li key={step.title} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#b55fbe]/30 bg-[#b55fbe]/10 text-[10px] font-semibold">0{index + 1}</span><div><p className="text-xs font-semibold">{step.title}</p><p className="mt-1.5 text-xs leading-6 text-[var(--muted-text)]">{step.text}</p></div></li>)}</ol></div><div className="rounded-2xl border border-[var(--border-soft)] p-6"><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-[#b55fbe]" aria-hidden="true" /><h2 className="text-sm">A thoughtful first impression</h2></div><p className="mt-3 text-xs leading-6 text-[var(--muted-text)]">Use a clear, high quality image and tell the story in your own words. Only share work you own or have permission to submit.</p></div><div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-5"><p className="flex items-center gap-2 text-xs font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-[#b55fbe]" />Arc Testnet pilot</p><p className="mt-2 text-xs leading-6 text-[var(--muted-text)]">We’re building in the open. Listed prices use test USDC, which has no monetary value.</p></div></aside>
        </div>
      </div>
    </main>
  );
}
