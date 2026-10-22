import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { itemMetadataUri } from "@/lib/itemMetadata";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function handleGET(request: NextRequest, { params }: { params: { id: string } }) {
  const [item, session] = await Promise.all([
    prisma.item.findUnique({ where: { id: params.id }, include: { creator: { select: { id: true, walletAddress: true, username: true } }, collectionImages: { orderBy: { position: "asc" } } } }),
    getCreatorSession(request, false),
  ]);
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404, headers });
  let metadataUrl: string | null = null;
  if (item.itemType === "NFT") {
    try { metadataUrl = itemMetadataUri(item); } catch { /* Deployment stays unavailable until a canonical URL exists. */ }
  }
  return NextResponse.json({ item, isOwner: session?.userId === item.creatorId, metadataUrl }, { headers });
}

export const GET = withAbuseProtection("GET items/[id]", "read", handleGET);
