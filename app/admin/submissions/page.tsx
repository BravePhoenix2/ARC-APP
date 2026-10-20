"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, ClipboardCheck, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import ArticLogo from "@/components/ArticLogo";
import Atmosphere from "@/components/Atmosphere";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import ThemeToggle from "@/components/ThemeToggle";
import { usePrivySession } from "@/hooks/usePrivySession";
import { arcChain } from "@/lib/arcConfig";
import { NFT_KIND_INFO, type NftKind, type NftAttribute } from "@/lib/nftTypes";

type SubmissionStatus = "PENDING" | "APPROVED" | "REJECTED";
type ReviewDecision = Exclude<SubmissionStatus, "PENDING">;
type CreationMethod = "HUMAN" | "AI_GENERATED" | "AI_ASSISTED" | "UNKNOWN";
type ImageScreening = {
  version: 1;
  status: "FLAGGED" | "REVIEW_REQUIRED";
  signals: { code: string; label: string }[];
  summary: string;
  checkedAt: string;
  provider?: {
    name: "sightengine";
    status: "COMPLETED" | "NOT_CONFIGURED" | "ERROR";
    score?: number;
  };
};

type Submission = {
  id: string;
  title: string;
  description: string;
  itemType: "NFT" | "WEB2_ART";
  imageUrl: string;
  creatorName: string;
  contactEmail: string | null;
  priceUsdc: number | string;
  category?: string | null;
  maxSupply?: number | null;
  nftKind?: NftKind | null;
  symbol?: string | null;
  maxPerWallet?: number | null;
  royaltyBps?: number | null;
  metadataUri?: string | null;
  attributes?: NftAttribute[] | null;
  contractAddress?: string | null;
  mintStartTime?: string | null;
  status: SubmissionStatus;
  reviewNote?: string | null;
  createdAt: string;
  creator: { walletAddress: string | null; email?: string | null };
  itemId?: string | null;
  creationMethod?: CreationMethod | null;
  humanMadeDeclaration?: boolean | null;
  creationProcess?: string | null;
  screening?: ImageScreening | null;
};

const filters: { value: SubmissionStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border-soft)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--chip-bg)] disabled:cursor-not-allowed disabled:opacity-50";

function messageFrom(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CreationDetails({ submission }: { submission: Submission }) {
  const screening = submission.screening;
  const provider = screening?.provider;
  const isNft = submission.itemType === "NFT";
  const methods: Record<CreationMethod, string> = {
    HUMAN: "Human-made",
    AI_GENERATED: "AI-generated",
    AI_ASSISTED: "AI-assisted",
    UNKNOWN: "Not specified",
  };

  return (
    <section className="mt-6 rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] p-4 sm:p-5" aria-labelledby={`creation-details-${submission.id}`}>
      <h3 id={`creation-details-${submission.id}`} className="text-base">Creation details</h3>
      <p className="mt-2 text-xs leading-5 text-[var(--muted-text)]">{isNft ? "AI-generated and AI-assisted works are allowed in NFTs." : "Original art must be human-made. Generative AI artwork is not eligible for this category."}</p>
      <dl className="mt-4 space-y-4 text-sm">
        {isNft && <>
          <div><dt className="text-xs text-[var(--faint-text)]">NFT type</dt><dd className="mt-1 font-semibold">{NFT_KIND_INFO[submission.nftKind ?? "COLLECTIBLE"].label} · {NFT_KIND_INFO[submission.nftKind ?? "COLLECTIBLE"].standard}</dd></div>
          <div><dt className="text-xs text-[var(--faint-text)]">Token settings</dt><dd className="mt-1 leading-6">{submission.symbol || "No symbol"} · {submission.maxPerWallet ? `${submission.maxPerWallet} per wallet` : "No per-wallet limit specified"} · {(Number(submission.royaltyBps ?? 0) / 100).toLocaleString()}% resale royalties</dd></div>
          {submission.nftKind === "SOULBOUND" && <div><dt className="text-xs text-[var(--faint-text)]">Transfers and resale</dt><dd className="mt-1 leading-6">Non-transferable. Secondary listings are disabled.</dd></div>}
          {submission.metadataUri && <div><dt className="text-xs text-[var(--faint-text)]">Metadata URI</dt><dd className="mt-1 break-all font-mono text-xs leading-5">{submission.metadataUri}</dd></div>}
          {!!submission.attributes?.length && <div><dt className="text-xs text-[var(--faint-text)]">Traits</dt><dd className="mt-1 flex flex-wrap gap-2">{submission.attributes.map((attribute, index) => <span key={index} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs">{attribute.trait_type}: {attribute.value}</span>)}</dd></div>}
        </>}
        <div><dt className="text-xs text-[var(--faint-text)]">Creator’s stated method</dt><dd className="mt-1 font-semibold">{methods[submission.creationMethod ?? "UNKNOWN"]}</dd></div>
        {!isNft && <div><dt className="text-xs text-[var(--faint-text)]">Human-made declaration</dt><dd className="mt-1">{submission.humanMadeDeclaration === true ? "The creator declared this artwork human-made." : "No human-made declaration was provided."}</dd></div>}
        <div><dt className="text-xs text-[var(--faint-text)]">Creation process</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6 text-[var(--muted-text)]">{submission.creationProcess?.trim() || "The creator did not provide creation details."}</dd></div>
      </dl>
      <div className="mt-5 border-t border-[var(--border-soft)] pt-4">
        <h4 className="text-sm">{screening?.status === "FLAGGED" ? "Possible AI signals — review required" : "Image screening — human review required"}</h4>
        {screening ? (
          <>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">{screening.summary}</p>
            {screening.signals.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-5 text-[var(--muted-text)]">{screening.signals.map((signal, index) => <li key={`${signal.code}-${index}`}><span className="font-semibold">Screening signal:</span> {signal.label}</li>)}</ul>}
            {provider?.status === "COMPLETED" ? (
              <p className="mt-3 text-xs leading-5 text-[var(--muted-text)]">Sightengine · {typeof provider.score === "number" && Number.isFinite(provider.score) ? `Model AI score: ${provider.score.toFixed(3)}.` : "Model check completed without a score."} This is a model estimate and does not prove how the work was created.</p>
            ) : (
              <p className="mt-3 text-xs leading-5 text-[var(--muted-text)]">{provider?.status === "ERROR" ? "The automated image model was unavailable. No model result is available for this review." : provider?.status === "NOT_CONFIGURED" ? "The automated image model is not configured. No model result is available for this review." : "No automated image model result is available for this review."}</p>
            )}
            <p className="mt-2 text-xs text-[var(--faint-text)]">Screened {dateLabel(screening.checkedAt)}</p>
          </>
        ) : (
          <p className="mt-2 text-sm leading-6 text-[var(--muted-text)]">No image screening report is available.{!isNft && " The creator must resubmit with an uploaded artwork image before approval."}</p>
        )}
        <p className="mt-3 text-xs leading-5 text-[var(--muted-text)]">Metadata can be modified or removed. Missing markers, an unflagged image, or a low model score do not verify that a work is human-made. Review the artwork and creation evidence directly.</p>
      </div>
    </section>
  );
}

function ReviewCard({ submission, onReview }: {
  submission: Submission;
  onReview: (submission: Submission, decision: ReviewDecision, reviewNote: string, artReviewConfirmed: boolean) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [artReviewConfirmed, setArtReviewConfirmed] = useState(false);
  const submitting = useRef(false);
  const isNft = submission.itemType === "NFT";
  const artRequirementsMet = submission.humanMadeDeclaration === true && submission.creationMethod === "HUMAN" && (submission.creationProcess?.trim().length ?? 0) >= 30 && submission.screening != null && submission.imageUrl.startsWith("/api/uploads/");

  async function review(nextDecision: ReviewDecision) {
    if (submitting.current) return;
    if (nextDecision === "REJECTED" && !note.trim()) {
      setError("Add a reason so the creator knows why this application was rejected.");
      document.getElementById(`review-note-${submission.id}`)?.focus();
      return;
    }
    if (nextDecision === "APPROVED" && !isNft) {
      if (!artRequirementsMet) {
        setError("This artwork is missing required creation details or an image screening report. Ask the creator to resubmit before approving it.");
        return;
      }
      if (!artReviewConfirmed) {
        setError("Review the artwork and creation evidence, then confirm your human-made assessment before approving.");
        document.getElementById(`art-review-confirmed-${submission.id}`)?.focus();
        return;
      }
      if (note.trim().length < 20) {
        setError("Add at least 20 characters explaining the evidence behind your human-made assessment.");
        document.getElementById(`review-note-${submission.id}`)?.focus();
        return;
      }
    }
    submitting.current = true;
    setDecision(nextDecision);
    setError("");
    try {
      await onReview(submission, nextDecision, note.trim(), !isNft && nextDecision === "APPROVED" && artReviewConfirmed);
    } catch (cause) {
      setError(messageFrom(cause, "The review could not be saved. Please try again."));
    } finally {
      submitting.current = false;
      setDecision(null);
    }
  }

  return (
    <article className="gallery-card overflow-hidden" aria-labelledby={`submission-${submission.id}`}>
      <div className="grid md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[290px_minmax(0,1fr)]">
        <div className="gallery-card-media relative aspect-square bg-[var(--chip-bg)] md:aspect-auto md:min-h-[320px]">
          {submission.imageUrl && !imageFailed ? (
            <Image src={submission.imageUrl} alt={submission.title} fill unoptimized sizes="(min-width: 1024px) 290px, (min-width: 768px) 240px, 100vw" onError={() => setImageFailed(true)} className="object-cover" />
          ) : (
            <div className="art-placeholder absolute inset-0"><span className="art-placeholder-shape" aria-hidden="true" /><span className="text-xs">Preview unavailable</span></div>
          )}
          <span className="absolute left-4 top-4 rounded-full border border-[var(--border-soft)] bg-[var(--glass-bg)] px-3 py-1.5 text-xs font-semibold backdrop-blur-md">{isNft ? "NFT collection" : "Original art"}</span>
          {submission.imageUrl && !imageFailed && <a href={submission.imageUrl} target="_blank" rel="noreferrer" className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--glass-bg)] px-3 py-2 text-xs font-semibold backdrop-blur-md">View full image <ArrowUpRight size={14} aria-hidden="true" /></a>}
        </div>
        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[var(--faint-text)]">Submitted {dateLabel(submission.createdAt)}</p>
              <h2 id={`submission-${submission.id}`} className="mt-2 break-words text-2xl">{submission.title}</h2>
              <p className="mt-2 break-words text-sm text-[var(--muted-text)]">By {submission.creatorName}</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${submission.status === "APPROVED" ? "bg-[#2FE6A6]/15 text-[var(--page-text)]" : submission.status === "REJECTED" ? "bg-[#EF476F]/10 text-[var(--page-text)]" : "bg-[#b55fbe]/15 text-[var(--page-text)]"}`}>{filters.find((filter) => filter.value === submission.status)?.label}</span>
          </div>
          <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted-text)]">{submission.description}</p>
          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
            <div><dt className="text-xs text-[var(--faint-text)]">{isNft ? "Mint price" : "Price"}</dt><dd className="mt-1 font-semibold">{submission.priceUsdc} USDC</dd></div>
            {submission.category && <div><dt className="text-xs text-[var(--faint-text)]">Category</dt><dd className="mt-1">{({ PAINTING: "Painting", RUG: "Artistic rug", COSMETIC: "Artistic cosmetic", OTHER: "Other" } as Record<string, string>)[submission.category] ?? submission.category}</dd></div>}
            {isNft && submission.maxSupply != null && <div><dt className="text-xs text-[var(--faint-text)]">Maximum supply</dt><dd className="mt-1">{submission.maxSupply}</dd></div>}
            {isNft && submission.mintStartTime && <div><dt className="text-xs text-[var(--faint-text)]">Mint starts</dt><dd className="mt-1">{dateLabel(submission.mintStartTime)}</dd></div>}
            <div className="col-span-2 min-w-0"><dt className="text-xs text-[var(--faint-text)]">Creator account</dt><dd className="mt-1 break-all font-mono text-xs leading-5">{submission.creator.walletAddress || submission.creator.email || "Email account"}</dd></div>
            <div className="col-span-2 min-w-0"><dt className="text-xs text-[var(--faint-text)]">Contact email</dt><dd className="mt-1 break-all">{submission.contactEmail || "Not provided"}</dd></div>
            {isNft && submission.contractAddress && <div className="col-span-2 min-w-0"><dt className="text-xs text-[var(--faint-text)]">Collection contract</dt><dd className="mt-1 break-all font-mono text-xs leading-5">{submission.contractAddress}</dd></div>}
          </dl>
          <CreationDetails submission={submission} />
          {submission.status === "PENDING" ? (
            <div className="mt-6 border-t border-[var(--border-soft)] pt-5">
              {!isNft && !artRequirementsMet && <p className="mb-5 rounded-xl border border-[#EF476F]/25 bg-[#EF476F]/5 p-4 text-sm leading-6 text-[var(--page-text)]">This application cannot be approved. Ask the creator to resubmit with a human-made declaration, at least 30 characters describing the creation process, and an uploaded artwork image with a screening report. You can reject this application with that feedback.</p>}
              {!isNft && <label className="mb-5 flex items-start gap-3 rounded-xl border border-[var(--border-soft)] p-4 text-sm leading-6"><input id={`art-review-confirmed-${submission.id}`} type="checkbox" checked={artReviewConfirmed} onChange={(event) => setArtReviewConfirmed(event.target.checked)} disabled={decision !== null || !artRequirementsMet} className="mt-1 h-4 w-4 shrink-0 accent-[#b55fbe] disabled:opacity-50" /><span>I reviewed the artwork and creation details and found sufficient evidence that it is human-made.</span></label>}
              <label htmlFor={`review-note-${submission.id}`} className="text-sm font-semibold">Review note</label>
              <p id={`review-help-${submission.id}`} className="mt-1 text-xs leading-5 text-[var(--faint-text)]">{isNft ? "Required for rejection; optional for approval. The creator can see this note." : "For approval, explain the evidence behind your human-made assessment in at least 20 characters. If a possible AI signal is a false positive, explain why. Rejection requires a reason. The creator can see this note."}</p>
              <textarea id={`review-note-${submission.id}`} aria-describedby={`review-help-${submission.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} disabled={decision !== null} placeholder="Share your feedback with the creator…" className="mt-3 w-full resize-y rounded-xl border border-[var(--border-soft)] bg-[var(--chip-bg)] px-4 py-3 text-sm leading-6 text-[var(--page-text)] placeholder:text-[var(--faint-text)] focus:outline-none focus:ring-2 focus:ring-[#b55fbe]/40 disabled:opacity-60" />
              <p className="mt-1 text-right text-xs text-[var(--faint-text)]">{note.length}/1,000</p>
              {isNft && <p className="mt-2 text-xs leading-5 text-[var(--muted-text)]">Approval publishes this collection entry in the marketplace. Minting and contract deployment are separate steps.</p>}
              {error && <p role="alert" className="mt-3 text-sm leading-6 text-[#EF476F]">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" disabled={decision !== null || (!isNft && !artRequirementsMet)} onClick={() => void review("APPROVED")} className="gallery-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {decision === "APPROVED" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{decision === "APPROVED" ? "Publishing…" : "Approve & publish"}
                </button>
                <button type="button" disabled={decision !== null} onClick={() => void review("REJECTED")} className={secondaryButton}>
                  {decision === "REJECTED" ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <X size={16} aria-hidden="true" />}{decision === "REJECTED" ? "Saving…" : "Reject application"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-6 border-t border-[var(--border-soft)] pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--faint-text)]">Review note</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted-text)]">{submission.reviewNote || "No note was added."}</p>
              {submission.status === "APPROVED" && <Link href={`/marketplace?mode=${isNft ? "nft" : "art"}&q=${encodeURIComponent(submission.title)}`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold">View in marketplace <ArrowUpRight size={15} aria-hidden="true" /></Link>}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function SubmissionReviewPage() {
  const session = usePrivySession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SubmissionStatus>("PENDING");
  const [notice, setNotice] = useState("");
  const accountId = session.user?.id;
  const authorized = Boolean(session.authenticated && session.user?.isAdmin && session.user.email);
  const reviewerHeaders = useMemo((): Record<string, string> => accountId ? { "X-Artiq-Account-ID": accountId } : {}, [accountId]);
  const queryKey = ["admin-submissions", accountId, status];

  useEffect(() => {
    if (!session.isLoading && !authorized) queryClient.removeQueries({ queryKey: ["admin-submissions"] });
  }, [authorized, queryClient, session.isLoading]);

  const submissions = useQuery({
    queryKey,
    enabled: authorized,
    retry: false,
    queryFn: async (): Promise<Submission[]> => {
      if (!authorized || !accountId) throw new Error("Sign in with an approved reviewer email to continue.");
      const response = await fetch(`/api/admin/submissions?status=${status}`, {
        cache: "no-store",
        headers: reviewerHeaders,
      });
      if (response.status === 401 || response.status === 403) await session.refresh();
      if (!response.ok) throw new Error(await responseError(response, "We couldn't load the review queue. Refresh and try again."));
      const body = await response.json();
      return body.submissions;
    },
  });

  async function review(submission: Submission, decision: ReviewDecision, reviewNote: string, artReviewConfirmed: boolean) {
    if (!authorized || !accountId) throw new Error("Sign in with an approved reviewer email to continue.");
    setNotice("");
    const response = await fetch(`/api/admin/submissions/${encodeURIComponent(submission.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...reviewerHeaders },
      body: JSON.stringify({ decision, reviewNote, artReviewConfirmed }),
    });
    if (response.status === 401 || response.status === 403) await session.refresh();
    if (!response.ok) throw new Error(await responseError(response, "The review could not be saved. Refresh the queue and try again."));
    queryClient.setQueryData<Submission[]>(["admin-submissions", accountId, "PENDING"], (previous) => previous?.filter((item) => item.id !== submission.id));
    setNotice(decision === "APPROVED" ? `“${submission.title}” was approved and published in the marketplace.` : `“${submission.title}” was rejected. The creator can see your feedback.`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-submissions"] }),
      ...(decision === "APPROVED" ? [queryClient.invalidateQueries({ queryKey: ["items"] })] : []),
    ]);
  }

  return (
    <main className="gallery-page min-h-screen text-[var(--page-text)]">
      <Atmosphere />
      <header className="gallery-nav z-30 border-b border-[var(--border-soft)] px-6 py-4 sm:px-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="Artiq home"><ArticLogo className="text-2xl" /></Link>
          <div className="flex flex-wrap items-center justify-end gap-3"><Link href="/marketplace" className="hidden items-center gap-2 text-sm font-semibold sm:flex"><ArrowLeft size={15} aria-hidden="true" /> Marketplace</Link><ThemeToggle /><ConnectWalletButton /></div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10 sm:py-14">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--faint-text)]"><ShieldCheck size={14} aria-hidden="true" /> The curator’s desk</p>
            <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Art worth <span className="hero-word">sharing.</span></h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--muted-text)]">Review creator applications. Approved NFTs and original art are published in the Artiq marketplace.</p>
          </div>
          <span className="rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] px-3 py-2 text-xs font-semibold">{arcChain.name}{arcChain.testnet ? " · Test USDC" : ""}</span>
        </div>

        {session.isLoading ? (
          <div role="status" className="gallery-card mt-10 flex items-center gap-3 p-7 text-sm text-[var(--muted-text)]"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Checking reviewer access…</div>
        ) : !session.authenticated ? (
          <section className="gallery-card mx-auto mt-10 max-w-xl p-7 sm:p-9">
            <span className="inline-flex rounded-2xl bg-[#b55fbe]/10 p-3 text-[#b55fbe]"><ShieldCheck size={25} aria-hidden="true" /></span>
            <h2 className="mt-5 text-2xl">Sign in to review</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">Use your approved reviewer email and enter the one-time code sent by Privy to open the review queue.</p>
            <div className="mt-6 flex"><button type="button" onClick={() => session.login({ loginMethods: ["email"] })} disabled={!session.ready || session.isSyncing} className="gallery-button rounded-full px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">Continue with email</button></div>
            {session.error && <p role="alert" className="mt-4 text-sm leading-6 text-[#EF476F]">{messageFrom(session.error, "Sign-in failed. Please try again.")}</p>}
          </section>
        ) : !authorized ? (
          <section className="gallery-card mx-auto mt-10 max-w-xl p-7 sm:p-9">
            <ShieldCheck size={28} className="text-[#b55fbe]" aria-hidden="true" />
            <h2 className="mt-5 text-2xl">Reviewer access required</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">{session.user?.email ? `You’re signed in as ${session.user.email}. This email does not have reviewer access.` : "Sign in with an approved reviewer email to open the queue."}</p>
            <div className="mt-6 flex flex-wrap gap-3"><Link href="/marketplace" className={secondaryButton}>Explore marketplace</Link><button type="button" onClick={() => void session.logout()} className={secondaryButton}>Sign out to change email</button></div>
            {session.error && <p role="alert" className="mt-4 text-sm leading-6 text-[#EF476F]">{messageFrom(session.error, "Could not sign out. Please try again.")}</p>}
          </section>
        ) : (
          <section className="mt-10" aria-label="Submission review queue">
            <p className="mb-5 break-all text-xs text-[var(--muted-text)]">Reviewing as <strong className="text-[var(--page-text)]">{session.user?.email}</strong></p>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-soft)] pb-5">
              <div role="group" aria-label="Filter submissions by status" className="flex max-w-full gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--chip-bg)] p-1">
                {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={status === filter.value} onClick={() => { setStatus(filter.value); setNotice(""); }} className={`rounded-full px-4 py-2 text-sm font-semibold transition sm:px-5 ${status === filter.value ? "gallery-button text-white" : "text-[var(--muted-text)] hover:text-[var(--page-text)]"}`}>{filter.label}</button>)}
              </div>
              <button type="button" onClick={() => void submissions.refetch()} disabled={submissions.isFetching} className={secondaryButton}><RefreshCw size={15} className={submissions.isFetching ? "animate-spin" : ""} aria-hidden="true" />{submissions.isFetching ? "Refreshing…" : "Refresh queue"}</button>
            </div>
            <p role="status" aria-live="polite" className="mt-5 text-sm leading-6 text-[var(--muted-text)]">{notice || (submissions.isLoading ? "Loading applications…" : submissions.isError ? "The review queue is unavailable." : `${submissions.data?.length ?? 0} ${status.toLowerCase()} ${(submissions.data?.length ?? 0) === 1 ? "application" : "applications"}`)}</p>
            {submissions.isLoading ? (
              <div className="mt-6 space-y-5" aria-hidden="true">{[0, 1].map((index) => <div key={index} className="gallery-card h-72 animate-pulse bg-[var(--chip-bg)]" />)}</div>
            ) : submissions.isError ? (
              <div role="alert" className="gallery-card mt-6 p-7"><h2 className="text-lg">We couldn’t load applications</h2><p className="mt-3 text-sm leading-6 text-[var(--muted-text)]">{messageFrom(submissions.error, "Refresh the queue and try again.")}</p><button type="button" disabled={submissions.isFetching} onClick={() => void submissions.refetch()} className={`${secondaryButton} mt-5`}>Try again</button></div>
            ) : submissions.data?.length ? (
              <div className="mt-6 space-y-6">{submissions.data.map((submission) => <ReviewCard key={submission.id} submission={submission} onReview={review} />)}</div>
            ) : (
              <div className="gallery-card mt-6 flex flex-col items-center px-6 py-16 text-center"><span className="rounded-2xl bg-[#b55fbe]/10 p-4 text-[#b55fbe]"><ClipboardCheck size={30} aria-hidden="true" /></span><h2 className="mt-5 text-xl">{status === "PENDING" ? "You’re all caught up." : `No ${status.toLowerCase()} applications yet.`}</h2><p className="mt-3 max-w-md text-sm leading-6 text-[var(--muted-text)]">{status === "PENDING" ? "New creator applications will appear here when they’re ready for your review." : "Applications will appear here after a reviewer makes a decision."}</p></div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
