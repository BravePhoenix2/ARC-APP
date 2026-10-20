import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import type { Prisma } from "@/lib/generated/prisma/client";
import { awardTesterMilestone } from "@/lib/testerLeaderboard";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to review applications." }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "Reviewer access is required." }, { status: 403 });
  let body;
  try { body = await limitedJson(request); } catch { return NextResponse.json({ error: "Invalid review request." }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid review request." }, { status: 400 });
  const { decision, reviewNote, artReviewConfirmed } = body as { decision?: unknown; reviewNote?: unknown; artReviewConfirmed?: unknown };
  if (decision !== "APPROVED" && decision !== "REJECTED") return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  if (reviewNote != null && (typeof reviewNote !== "string" || reviewNote.length > 1000)) return NextResponse.json({ error: "Review note must be under 1,001 characters." }, { status: 400 });
  const note = typeof reviewNote === "string" ? reviewNote.trim() : null;
  if (decision === "REJECTED" && !note) return NextResponse.json({ error: "Give the creator a reason for rejection." }, { status: 400 });
  try {
    const submission = await prisma.$transaction(async (tx) => {
      const application = await tx.submission.findUnique({ where: { id: params.id } });
      if (!application) throw new Error("NOT_FOUND");
      if (application.status !== "PENDING") throw new Error("ALREADY_REVIEWED");
      if (decision === "APPROVED" && application.itemType === "WEB2_ART") {
        if (!application.humanMadeDeclaration || application.creationMethod !== "HUMAN" || !application.creationProcess || application.creationProcess.trim().length < 30 || !application.screening || !application.imageUrl.startsWith("/api/uploads/")) throw new Error("ART_EVIDENCE_REQUIRED");
        if (artReviewConfirmed !== true || !note || note.length < 20) throw new Error("ART_REVIEW_REQUIRED");
      }
      // A conditional update prevents two reviewers publishing the same application.
      const claimed = await tx.submission.updateMany({ where: { id: params.id, status: "PENDING" }, data: {
        status: decision, reviewNote: note, artReviewConfirmed: decision === "APPROVED" && application.itemType === "WEB2_ART" && artReviewConfirmed === true, reviewedBy: `user:${session.userId}`, reviewedAt: new Date(),
      } });
      if (claimed.count !== 1) throw new Error("ALREADY_REVIEWED");
      if (decision === "APPROVED") {
        const creator = await tx.user.update({ where: { id: application.creatorId }, data: { isCreator: true } });
        if (!creator.username) await tx.user.update({ where: { id: creator.id }, data: { username: application.creatorName } });
        const item = await tx.item.create({ data: {
          creatorId: application.creatorId, creationMethod: application.creationMethod, itemType: application.itemType, title: application.title,
          description: application.description, imageUrl: application.imageUrl,
          ...(application.itemType === "NFT" ? {
            nftKind: application.nftKind ?? "COLLECTIBLE", symbol: application.symbol,
            metadataUri: application.metadataUri, maxPerWallet: application.maxPerWallet,
            royaltyBps: application.nftKind === "SOULBOUND" ? 0 : application.royaltyBps,
            ...(application.attributes !== null ? { attributes: application.attributes as Prisma.InputJsonValue } : {}),
            mintPriceUsdc: application.priceUsdc, maxSupply: application.maxSupply,
            mintStartTime: application.mintStartTime, contractAddress: application.contractAddress,
            mintedCount: 0, status: "UPCOMING",
          } : { priceUsdc: application.priceUsdc, category: application.category, quantityAvailable: 1, sold: false }),
        } });
        await tx.submission.update({ where: { id: params.id }, data: { itemId: item.id } });
        await awardTesterMilestone(tx, application.creatorId, "APPROVED_CREATOR");
      }
      return tx.submission.findUniqueOrThrow({ where: { id: params.id } });
    });
    return NextResponse.json({ submission }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "ART_EVIDENCE_REQUIRED") return NextResponse.json({ error: "This art application needs the creator's human-made declaration, process details, and a screened upload. Ask the creator to submit it again." }, { status: 409 });
    if (error instanceof Error && error.message === "ART_REVIEW_REQUIRED") return NextResponse.json({ error: "Review the creation details, confirm sufficient evidence of human authorship, and explain your decision in at least 20 characters." }, { status: 400 });
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (error instanceof Error && error.message === "ALREADY_REVIEWED") return NextResponse.json({ error: "This application has already been reviewed. Refresh the queue." }, { status: 409 });
    console.error("Application review failed", error);
    return NextResponse.json({ error: "Couldn't save the review. Please try again." }, { status: 500 });
  }
}
