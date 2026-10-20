import { NextRequest, NextResponse } from "next/server";
import { keccak256, parseEventLogs, toHex, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedJson } from "@/lib/requestBody";
import { artMarketAbi, protocol, usdcAmount } from "@/lib/protocol";
import { deploymentClient } from "@/lib/deploymentVerification";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in before linking a listing." }, { status: 401, headers });
  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404, headers });
  if (item.creatorId !== session.userId) return NextResponse.json({ error: "Only this artwork's creator can link its listing." }, { status: 403, headers });
  if (item.itemType !== "WEB2_ART") return NextResponse.json({ error: "This endpoint is for original Art listings." }, { status: 400, headers });
  if (!protocol.isTestnet || !protocol.artMarket) return NextResponse.json({ error: "Art checkout is not configured for Arc Testnet yet." }, { status: 503, headers });
  let body;
  try { body = await limitedJson(request, 4096); } catch { return NextResponse.json({ error: "Invalid listing request." }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || !("txHash" in body) || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) return NextResponse.json({ error: "Provide a valid listing transaction hash." }, { status: 400, headers });
  try {
    const receipt = await deploymentClient.getTransactionReceipt({ hash: body.txHash as Hash });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== protocol.artMarket.toLowerCase()) return NextResponse.json({ error: "The transaction must successfully create an Artiq Art listing." }, { status: 400, headers });
    const logs = parseEventLogs({ abi: artMarketAbi, eventName: "ArtListed", logs: receipt.logs.filter((log) => log.address.toLowerCase() === protocol.artMarket!.toLowerCase()), strict: true });
    const events = logs.filter(({ args }) => args.artId === keccak256(toHex(item.id)) && args.price === usdcAmount(String(item.priceUsdc ?? 0)) && args.seller.toLowerCase() === receipt.from.toLowerCase());
    if (events.length !== 1) return NextResponse.json({ error: "The listing's artwork, price, or seller does not match the approved artwork." }, { status: 400, headers });
    const { listingId, seller } = events[0].args;
    if (session.walletAddress && session.walletAddress.toLowerCase() !== seller.toLowerCase()) return NextResponse.json({ error: "The listing wallet must match your signed-in wallet." }, { status: 403, headers });
    if (item.artListingId && (item.artListingId !== String(listingId) || item.artListingSeller?.toLowerCase() !== seller.toLowerCase())) return NextResponse.json({ error: "A different listing is already linked to this artwork." }, { status: 409, headers });
    await prisma.item.updateMany({ where: { id: item.id, creatorId: session.userId, artListingId: null }, data: { artListingId: String(listingId), artListingSeller: seller } });
    const current = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    if (current.artListingId !== String(listingId) || current.artListingSeller?.toLowerCase() !== seller.toLowerCase()) return NextResponse.json({ error: "Another listing was linked first. Refresh this artwork." }, { status: 409, headers });
    return NextResponse.json({ item: current }, { headers });
  } catch {
    return NextResponse.json({ error: "The listing could not be verified on Arc. Wait for confirmation and try again." }, { status: 503, headers });
  }
}
