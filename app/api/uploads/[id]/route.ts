import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";

async function handleGET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[a-z0-9]{20,40}$/.test(params.id)) return new Response("Not found", { status: 404 });
  const image = await prisma.uploadedImage.findUnique({ where: { id: params.id } });
  if (!image) return new Response("Not found", { status: 404 });
  const published = await prisma.item.findFirst({ where: { OR: [{ imageUrl: `/api/uploads/${params.id}` }, { collectionImages: { some: { imageUrl: `/api/uploads/${params.id}` } } }] }, select: { id: true } });
  if (!published) {
    const session = await getCreatorSession(request, false);
    if (!session || (!session.isAdmin && session.userId !== image.ownerUserId && !(session.walletAddress && session.walletAddress === image.ownerWallet))) return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(image.data), { headers: {
    "Content-Type": image.mimeType,
    "Content-Length": String(image.data.byteLength),
    "Cache-Control": published ? "public, max-age=31536000, immutable" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

export const GET = withAbuseProtection("GET uploads/[id]", "read", handleGET);
