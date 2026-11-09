import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import { publishSubmission } from "@/lib/publishSubmission";

async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to review applications." }, { status: 401 });
  const limited = await protectAccount("interaction", session.userId, "admin/submissions/[id]", request);
  if (limited) return limited;
  if (!session.isAdmin) return NextResponse.json({ error: "Reviewer access is required." }, { status: 403 });
  let body;
  try { 
    body = await limitedJson(request); 
  } 
  catch {
     return NextResponse.json({ error: "Invalid review request." }, { status: 400 });
    }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid review request." }, { status: 400 });
  const { decision, reviewNote, artReviewConfirmed } = body as { decision?: unknown; reviewNote?: unknown; artReviewConfirmed?: unknown };
  if (decision !== "APPROVED" && decision !== "REJECTED") return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  if (reviewNote != null && (typeof reviewNote !== "string" || reviewNote.length > 1000)) return NextResponse.json({ error: "Review note must be under 1,001 characters." }, { status: 400 });
  const note = typeof reviewNote === "string" ? reviewNote.trim() : null;
  if (decision === "REJECTED" && !note) return NextResponse.json({ error: "Give the creator a reason for rejection." }, { status: 400 });
  try {
    const submission = await prisma.$transaction(async (tx) => {
      const application = await tx.submission.findUnique({ where: { id: params.id }, include: { collectionImages: { orderBy: { position: "asc" } } } });
      if (!application) throw new Error("NOT_FOUND");
      if (application.status !== "PENDING") throw new Error("ALREADY_REVIEWED");
      if (decision === "APPROVED" && application.itemType === "NFT" && application.contractAddress) throw new Error("NFT_DEPLOYMENT_REQUIRED");
      if (decision === "APPROVED" && application.itemType === "WEB2_ART") {
        if (!application.humanMadeDeclaration || application.creationMethod !== "HUMAN" || !application.creationProcess || application.creationProcess.trim().length < 30 || !application.screening || !application.imageUrl.startsWith("/api/uploads/")) throw new Error("ART_EVIDENCE_REQUIRED");
        if (artReviewConfirmed !== true || !note || note.length < 20) throw new Error("ART_REVIEW_REQUIRED");
      }
      // A conditional update prevents two reviewers publishing the same application.
      const claimed = await tx.submission.updateMany({ where: { id: params.id, status: "PENDING" }, data: {
        status: decision,
        reviewNote: note,
        artReviewConfirmed: decision === "APPROVED" && application.itemType === "WEB2_ART" && artReviewConfirmed === true, reviewedBy: `user:${session.userId}`, reviewedAt: new Date(),
      } });
      if (claimed.count !== 1) throw new Error("ALREADY_REVIEWED");
      if (decision === "APPROVED") {
        await publishSubmission(tx, application);
      }
      return tx.submission.findUniqueOrThrow({ where: { id: params.id } });
    });
    return NextResponse.json({ submission }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NFT_DEPLOYMENT_REQUIRED") return NextResponse.json({ error: "This application includes an unverified existing contract. Ask the creator to resubmit without it, then deploy from the approved collection page." }, { status: 409 });
    if (error instanceof Error && error.message === "ART_EVIDENCE_REQUIRED") return NextResponse.json({ error: "This art application needs the creator's human-made declaration, process details, and a screened upload. Ask the creator to submit it again." }, { status: 409 });
    if (error instanceof Error && error.message === "ART_REVIEW_REQUIRED") return NextResponse.json({ error: "Review the creation details, confirm sufficient evidence of human authorship, and explain your decision in at least 20 characters." }, { status: 400 });
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (error instanceof Error && error.message === "ALREADY_REVIEWED") return NextResponse.json({ error: "This application has already been reviewed. Refresh the queue." }, { status: 409 });
    console.error("Application review failed", error);
    return NextResponse.json({ error: "Couldn't save the review. Please try again." }, { status: 500 });
  }
}
export const PATCH = withAbuseProtection("PATCH admin/submissions/[id]", "interaction", handlePATCH);
