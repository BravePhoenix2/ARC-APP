import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { screenImage } from "@/lib/imageScreening";
import { limitedBody } from "@/lib/requestBody";
import { imageMime, maxImageBytes as maxFileSize } from "@/lib/imageUpload";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in before uploading artwork." }, { status: 401 });
  try {
    const recentUploads = await prisma.uploadedImage.count({ where: { OR: [{ ownerUserId: session.userId }, ...(session.walletAddress ? [{ ownerWallet: session.walletAddress }] : [])], createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recentUploads >= 30) return NextResponse.json({ error: "Upload limit reached. Please try again in an hour." }, { status: 429 });
    const bytes = await limitedBody(request, maxFileSize + 16_384);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > maxFileSize) return NextResponse.json({ error: "Upload an image up to 5 MB." }, { status: 400 });
    const data = Buffer.from(await file.arrayBuffer());
    const mimeType = imageMime(data);
    if (!mimeType || file.type !== mimeType) return NextResponse.json({ error: "Use a PNG, JPEG, or WebP image. SVG files are not supported." }, { status: 400 });
    const screening = screenImage(data, mimeType);
    const image = await prisma.uploadedImage.create({ data: { ownerUserId: session.userId, ownerWallet: session.walletAddress, mimeType, data: new Uint8Array(data), screening }, select: { id: true } });
    return NextResponse.json({ url: `/api/uploads/${image.id}`, screening }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 413 });
    return NextResponse.json({ error: "Couldn't upload this file. Please choose a valid image and try again." }, { status: 400 });
  }
}
