import type { ReactNode } from "react";
import Link from "next/link";
import ReviewerOnly from "@/components/ReviewerOnly";
import ConnectWalletButton from "@/components/ConnectWalletButton";
import { requireReviewerPage } from "@/lib/reviewerPage";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireReviewerPage();
  return <ReviewerOnly fallback={<main className="gallery-page min-h-screen px-6 py-16 text-[var(--page-text)]"><div className="mx-auto max-w-lg space-y-5"><p>Verify your account to continue.</p><ConnectWalletButton /><Link href="/marketplace" className="block text-sm underline">Return to marketplace</Link></div></main>}>{children}</ReviewerOnly>;
}
