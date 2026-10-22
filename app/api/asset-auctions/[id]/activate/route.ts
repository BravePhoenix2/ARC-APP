import { NextRequest, NextResponse } from "next/server";
import type { Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { assetAuctionPublicSelect, publicAssetAuction } from "@/lib/assetAuctions";
import { AssetAuctionVerificationError, verifiedAssetAuctionCreation } from "@/lib/assetAuctionVerification";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function handlePOST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in before publishing your auction." }, 401);
  const limited = await protectAccount("transaction", session.userId, "asset-auctions/activate", request);
  if (limited) return limited;
  const auction = await prisma.assetAuction.findUnique({ where: { id: params.id } });
  if (!auction) return json({ error: "Auction not found." }, 404);
  if (auction.sellerId !== session.userId || session.walletAddress?.toLowerCase() !== auction.sellerWallet.toLowerCase()) return json({ error: "Use the verified wallet that created this auction draft." }, 403);
  let hash: Hash;
  try {
    const body = await limitedJson(request, 4096);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("txHash" in body) || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) throw new Error("Provide a valid creation transaction hash.");
    hash = body.txHash.toLowerCase() as Hash;
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid creation transaction." }, 400); }
  try {
    const auctionId = await verifiedAssetAuctionCreation(auction, hash);
    if (auction.auctionId && (auction.auctionId !== auctionId || auction.activationTxHash !== hash)) return json({ error: "A different on-chain auction is already linked to this asset." }, 409);
    await prisma.assetAuction.updateMany({ where: { id: auction.id, sellerId: session.userId, auctionId: null }, data: { auctionId, activationTxHash: hash } });
    const current = await prisma.assetAuction.findUniqueOrThrow({ where: { id: auction.id }, select: assetAuctionPublicSelect });
    if (current.auctionId !== auctionId || current.activationTxHash !== hash) return json({ error: "Another auction was linked first. Refresh your auctions." }, 409);
    return json({ auction: publicAssetAuction(current, true) });
  } catch (error) {
    if (error instanceof AssetAuctionVerificationError) return json({ error: error.message }, 400);
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return json({ error: "This on-chain auction has already been linked to an asset." }, 409);
    return json({ error: "The creation transaction could not be verified. Keep its hash and retry after confirmation; do not create another auction." }, 503);
  }
}
export const POST = withAbuseProtection("POST asset-auctions/[id]/activate", "transaction", handlePOST);
