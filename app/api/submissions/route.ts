import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { parseSubmission, SubmissionValidationError } from "@/lib/submissionValidation";
import { screenArtwork } from "@/lib/artworkScreening";
import type { Prisma } from "@/lib/generated/prisma/client";
import { limitedJson } from "@/lib/requestBody";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in with email or your wallet." }, { status: 401, headers: privateHeaders });
  const submissions = await prisma.submission.findMany({
    where: { creatorId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ submissions }, { headers: privateHeaders });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in with email or your wallet before submitting." }, { status: 401 });
  try {
    const input = parseSubmission(await limitedJson(request, 65_536));
    const { images, ...details } = input;
    if (images.length) {
      const owned = await prisma.uploadedImage.count({ where: { id: { in: images.map((image) => image.imageUrl.split("/").pop()!) }, OR: [{ ownerUserId: session.userId }, ...(session.walletAddress ? [{ ownerWallet: session.walletAddress }] : [])] } });
      if (owned !== images.length) return NextResponse.json({ error: "Every series image must be uploaded by your account." }, { status: 400 });
    }
    // Check the queue before spending an optional detector operation. The
    // transaction repeats this check to handle concurrent submissions.
    const pending = await prisma.submission.count({ where: { creatorId: session.userId, status: "PENDING" } });
    if (pending >= 20) return NextResponse.json({ error: "You already have 20 applications awaiting review." }, { status: 429 });
    let screening: Prisma.InputJsonValue | undefined;
    if (input.imageUrl.startsWith("/api/uploads/")) {
      const image = await prisma.uploadedImage.findFirst({ where: { id: input.imageUrl.split("/").pop(), OR: [{ ownerUserId: session.userId }, ...(session.walletAddress ? [{ ownerWallet: session.walletAddress }] : [])] } });
      if (!image) return NextResponse.json({ error: "Upload your artwork image again." }, { status: 400 });
      if (input.itemType === "WEB2_ART") {
        // Always derive the result from the immutable stored image, never the request.
        screening = await screenArtwork(image.data, image.mimeType);
        await prisma.uploadedImage.update({ where: { id: image.id }, data: { screening } });
      } else if (image.screening) screening = image.screening;
    }
    // Bound the review queue without rate-limiting unrelated public browsing.
    const submission = await prisma.$transaction(async (tx) => {
      const pending = await tx.submission.count({ where: { creatorId: session.userId, status: "PENDING" } });
      if (pending >= 20) throw new Error("PENDING_LIMIT");
      return tx.submission.create({ data: { ...details, imageCount: images.length || 1, ...(images.length ? { collectionImages: { create: images.map((image, index) => ({ ...image, position: index + 1 })) } } : {}), ...(screening ? { screening } : {}), creatorId: session.userId } });
    });
    return NextResponse.json({ submission }, { status: 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof SubmissionValidationError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "Application is too large." }, { status: 413 });
    if (error instanceof Error && error.message === "PENDING_LIMIT") return NextResponse.json({ error: "You already have 20 applications awaiting review." }, { status: 429 });
    console.error("Application submission failed", error);
    return NextResponse.json({ error: "Couldn't save your application. Please try again." }, { status: 500 });
  }
}
