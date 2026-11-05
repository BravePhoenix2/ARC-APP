import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { publicItemWhere } from "@/lib/publicCatalog";
import { publicImageBytes } from "@/lib/imageUpload";
import { loadUploadBytes } from "@/lib/uploadStorage";

async function handleGET(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  if (!/^[a-z0-9]{20,40}$/.test(params.id)) return new Response("Not found", { status: 404 });
  const image = await prisma.uploadedImage.findUnique({ where: { id: params.id } });
  if (!image) return new Response("Not found", { status: 404 });
  const [publishedItem, publishedAuction] = await Promise.all([
    prisma.item.findFirst({ where: { AND: [publicItemWhere], OR: [{ imageUrl: `/api/uploads/${params.id}` }, { collectionImages: { some: { imageUrl: `/api/uploads/${params.id}` } } }] }, select: { id: true } }),
    prisma.assetAuction.findFirst({ where: { imageUrl: `/api/uploads/${params.id}`, auctionId: { not: null } }, select: { id: true } }),
  ]);
  const published = publishedItem || publishedAuction;
  if (!published) {
    const session = await getCreatorSession(request, false);
    if (!session || (!session.isAdmin && session.userId !== image.ownerUserId && !(session.walletAddress && session.walletAddress === image.ownerWallet))) return new Response("Not found", { status: 404 });
  }
  let bytes;
  try { bytes = await publicImageBytes(await loadUploadBytes(image), image.mimeType, image.screening); }
  catch { return new Response("Artwork image is temporarily unavailable", { status: 503, headers: { "Cache-Control": "private, no-store" } }); }
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": image.mimeType,
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": published ? "public, max-age=31536000, immutable" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}

export const GET = withAbuseProtection("GET uploads/[id]", "read", handleGET);
