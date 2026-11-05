import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedBody } from "@/lib/requestBody";
import { ImageValidationError, maxAccountImageBytes, maxImageBytes as maxFileSize, prepareUploadedImage } from "@/lib/imageUpload";
import { saveUploadBytes, removeUploadObject, UploadStorageError } from "@/lib/uploadStorage";

export const runtime = "nodejs";

class UploadBudgetError extends Error {}

async function checkUploadBudget(client: Pick<typeof prisma, "uploadedImage">, userId: string, walletAddress: string | null, byteSize: number, countLimit: number) {
  const owner = { OR: [{ ownerUserId: userId }, ...(walletAddress ? [{ ownerWallet: walletAddress }] : [])] };
  const [hourly, total] = await Promise.all([
    client.uploadedImage.aggregate({ where: { ...owner, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }, _count: true, _sum: { byteSize: true } }),
    client.uploadedImage.aggregate({ where: owner, _sum: { byteSize: true } }),
  ]);
  if (hourly._count >= countLimit || (hourly._sum.byteSize ?? 0) + byteSize > 200 * 1024 * 1024) throw new UploadBudgetError("Hourly upload limit reached (200 MB). Keep your completed uploads and try again later.");
  if ((total._sum.byteSize ?? 0) + byteSize > maxAccountImageBytes) throw new UploadBudgetError("Your account has reached its 500 MB artwork storage allowance. Contact support before uploading more.");
}

async function handlePOST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in before uploading artwork." }, { status: 401 });
  const limited = await protectAccount("upload", session.userId, "uploads", request);
  if (limited) return limited;
  let storedKey: string | null = null;
  try {
    const bytes = await limitedBody(request, maxFileSize + 16_384);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > maxFileSize) return NextResponse.json({ error: "Upload an image up to 5 MB." }, { status: 400 });
    const limit = form.get("itemType") === "NFT" ? 200 : 30;
    await checkUploadBudget(prisma, session.userId, session.walletAddress, file.size, limit);
    const { data, mimeType, screening } = await prepareUploadedImage(Buffer.from(await file.arrayBuffer()), file.type);
    const stored = await saveUploadBytes(data, mimeType); storedKey = stored.storageKey;
    const image = await prisma.$transaction(async (tx) => {
      // Repeat quota reads atomically with insertion so concurrent uploads
      // cannot each claim the final bytes of one account's storage budget.
      await checkUploadBudget(tx, session.userId, session.walletAddress, data.byteLength, limit);
      return tx.uploadedImage.create({ data: { ownerUserId: session.userId, ownerWallet: session.walletAddress, mimeType, byteSize: data.byteLength, ...stored, screening }, select: { id: true } });
    }, { isolationLevel: "Serializable" });
    storedKey = null;
    return NextResponse.json({ url: `/api/uploads/${image.id}`, screening }, { status: 201 });
  } catch (error) {
    if (storedKey) await removeUploadObject(storedKey).catch(() => { console.error("Unattached artwork object requires storage cleanup."); });
    if (error instanceof UploadBudgetError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof ImageValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof UploadStorageError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2034") return NextResponse.json({ error: "Another upload changed your storage budget. Keep completed uploads and retry this file." }, { status: 429 });
    if (error instanceof Error && error.message === "BODY_TOO_LARGE") return NextResponse.json({ error: "Image must be under 5 MB." }, { status: 413 });
    return NextResponse.json({ error: "Couldn't upload this file. Please choose a valid image and try again." }, { status: 400 });
  }
}

export const POST = withAbuseProtection("POST uploads", "upload", handlePOST);
