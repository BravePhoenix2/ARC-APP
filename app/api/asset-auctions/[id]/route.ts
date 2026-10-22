import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { withAbuseProtection } from "@/lib/abuseProtection";
import { assetAuctionPublicSelect, publicAssetAuction } from "@/lib/assetAuctions";

export const dynamic = "force-dynamic";
async function handleGET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getCreatorSession(request);
  const auction = await prisma.assetAuction.findUnique({ where: { id: params.id }, select: { ...assetAuctionPublicSelect, sellerId: true } });
  const isOwner = !!session && auction?.sellerId === session.userId;
  const headers = { "Cache-Control": "private, no-store" };
  if (!auction || (!auction.auctionId && !isOwner)) return NextResponse.json({ error: "Auction not found." }, { status: 404, headers });
  return NextResponse.json({ auction: publicAssetAuction(auction, isOwner) }, { headers });
}
export const GET = withAbuseProtection("GET asset-auctions/[id]", "read", handleGET);
