import { NextRequest, NextResponse } from "next/server";
import { zeroAddress } from "viem";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { validateArtDelivery } from "@/lib/artDelivery";
import { AssetAuctionVerificationError, readVerifiedAssetAuction } from "@/lib/assetAuctionVerification";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
type Context = { params: { id: string } };

async function fulfillment(request: NextRequest, { params }: Context, save: boolean) {
  if (save && !sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in to access private fulfillment details." }, 401);
  if (!session.walletAddress) return json({ error: "Select your verified seller or winning wallet." }, 403);
  const limited = await protectAccount(save ? "transaction" : "read", session.userId, "asset-auctions/fulfillment", request);
  if (limited) return limited;
  const auction = await prisma.assetAuction.findUnique({ where: { id: params.id } });
  if (!auction) return json({ error: "Auction not found." }, 404);
  if (!auction.auctionId) return json({ error: "This auction has not been published yet." }, 409);
  const isSeller = auction.sellerId === session.userId && auction.sellerWallet.toLowerCase() === session.walletAddress.toLowerCase();
  let delivery;
  if (save) {
    if (auction.kind !== "PHYSICAL" || isSeller) return json({ error: "Only the winning bidder can submit a physical delivery address." }, 403);
    try {
      const body = await limitedJson(request, 8192);
      delivery = validateArtDelivery(body && typeof body === "object" && "delivery" in body ? body.delivery : null);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid delivery details." }, 400); }
  }
  try {
    const state = await readVerifiedAssetAuction(auction);
    const hasWinner = state.settled && state.highestBid > BigInt(0) && state.highestBidder !== zeroAddress;
    const isWinner = hasWinner && state.highestBidder.toLowerCase() === session.walletAddress.toLowerCase();
    if (!isSeller && !isWinner) return json({ error: "Private fulfillment is available only to the seller and the settled auction's winner." }, 403);
    if (save && !isWinner) return json({ error: "Wait until the auction ends and is settled before saving delivery details." }, 409);
    let current = auction;
    if (save && delivery) {
      await prisma.assetAuction.updateMany({ where: { id: auction.id, winnerWallet: null }, data: { winnerWallet: state.highestBidder.toLowerCase(), delivery } });
      current = await prisma.assetAuction.findUniqueOrThrow({ where: { id: auction.id } });
      if (current.winnerWallet !== state.highestBidder.toLowerCase()) return json({ error: "The saved fulfillment winner does not match this auction." }, 409);
    }
    return json({
      kind: auction.kind, settled: state.settled, winnerWallet: hasWinner ? state.highestBidder : null,
      digitalDeliveryUrl: auction.kind === "DIGITAL" && isWinner ? auction.digitalDeliveryUrl : null,
      delivery: auction.kind === "PHYSICAL" && hasWinner ? current.delivery : null,
      needsDelivery: auction.kind === "PHYSICAL" && isWinner && !current.delivery,
    });
  } catch (error) {
    if (error instanceof AssetAuctionVerificationError) return json({ error: error.message }, 400);
    return json({ error: "Settlement could not be verified on Arc. Try again shortly." }, 503);
  }
}

export const GET = withAbuseProtection("GET asset-auctions/[id]/fulfillment", "read", (request: NextRequest, context: Context) => fulfillment(request, context, false));
export const POST = withAbuseProtection("POST asset-auctions/[id]/fulfillment", "transaction", (request: NextRequest, context: Context) => fulfillment(request, context, true));
