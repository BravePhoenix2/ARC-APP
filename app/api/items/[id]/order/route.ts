import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { keccak256, parseEventLogs, toHex, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import { artMarketAbi, artMarketForItem, protocol, usdcAmount } from "@/lib/protocol";
import { deploymentClient } from "@/lib/deploymentVerification";
import { validateArtDelivery } from "@/lib/artDelivery";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function handleGET(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in to view delivery details." }, 401);
  const order = await prisma.artOrder.findFirst({ where: { itemId: params.id, OR: [{ buyerId: session.userId }, { item: { creatorId: session.userId } }] } });
  return json({ order });
}

async function handlePOST(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in before saving your delivery address." }, 401);
  const limited = await protectAccount("transaction", session.userId, "items/[id]/order", request);
  if (limited) return limited;
  if (!session.walletAddress) return json({ error: "Select a wallet linked to your signed-in account." }, 403);
  let body;
  let delivery;
  try {
    body = await limitedJson(request, 16_384);
    if (!body || typeof body !== "object" || Array.isArray(body) || !("txHash" in body) || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) return json({ error: "Provide the confirmed purchase transaction hash." }, 400);
    delivery = validateArtDelivery("delivery" in body ? body.delivery : null);
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid delivery details." }, 400); }
  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item || item.itemType !== "WEB2_ART") return json({ error: "Artwork not found." }, 404);
  if (item.creatorId === session.userId) return json({ error: "You cannot purchase your own artwork." }, 403);
  const market = artMarketForItem(item);
  if (!protocol.isTestnet || !market || !item.artListingId || !item.artListingSeller) return json({ error: "This artwork's checkout is not active yet." }, 409);
  const txHash = body.txHash.toLowerCase() as Hash;
  try {
    const [chainId, receipt, listing] = await Promise.all([
      deploymentClient.getChainId(),
      deploymentClient.getTransactionReceipt({ hash: txHash }),
      deploymentClient.readContract({ address: market, abi: artMarketAbi, functionName: "listings", args: [BigInt(item.artListingId)] }),
    ]);
    if (chainId !== 5042002 || receipt.status !== "success" || receipt.to?.toLowerCase() !== market.toLowerCase()) return json({ error: "A successful Arc Testnet art purchase is required." }, 400);
    const buyer = receipt.from.toLowerCase();
    if (buyer !== session.walletAddress.toLowerCase()) return json({ error: "This purchase belongs to a different wallet." }, 403);
    const events = parseEventLogs({ abi: artMarketAbi, eventName: "ArtPurchased", logs: receipt.logs.filter((log) => log.address.toLowerCase() === market.toLowerCase()), strict: true });
    const price = usdcAmount(String(item.priceUsdc));
    if (listing[0].toLowerCase() !== item.artListingSeller.toLowerCase() || listing[1] !== keccak256(toHex(item.id)) || listing[2] !== price || listing[3].toLowerCase() !== buyer || listing[4] ||
        events.filter(({ args }) => String(args.listingId) === item.artListingId && args.buyer.toLowerCase() === buyer && args.price === price).length !== 1) return json({ error: "The receipt does not match this artwork's purchase." }, 400);
    const order = await prisma.$transaction(async (tx) => {
      const saved = await tx.artOrder.upsert({ where: { itemId: item.id }, update: {}, create: {
        itemId: item.id, buyerId: session.userId, buyerWallet: buyer, chainId, marketAddress: market, listingId: item.artListingId!, txHash, delivery,
      } });
      if (saved.buyerId !== session.userId || saved.txHash !== txHash) throw new Error("ORDER_CONFLICT");
      await tx.item.update({ where: { id: item.id }, data: { sold: true, quantityAvailable: 0 } });
      return saved;
    });
    return json({ order });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_CONFLICT") return json({ error: "A different order is already attached to this artwork." }, 409);
    return json({ error: "Your payment may be confirmed, but the order could not be saved. Keep the transaction hash and retry; do not pay again." }, 503);
  }
}

export const GET = withAbuseProtection("GET items/[id]/order", "read", handleGET);
export const POST = withAbuseProtection("POST items/[id]/order", "transaction", handlePOST);
