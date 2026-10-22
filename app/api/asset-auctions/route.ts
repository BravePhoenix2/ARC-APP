import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { limitedJson } from "@/lib/requestBody";
import { protocol } from "@/lib/protocol";
import { assetAuctionCommitment, assetAuctionPublicSelect, publicAssetAuction, validateAssetAuction } from "@/lib/assetAuctions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

async function handleGET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const kind = search.get("kind");
  const rawPage = search.get("page") ?? "1";
  if ((kind && kind !== "DIGITAL" && kind !== "PHYSICAL") || !/^[1-9]\d{0,3}$/.test(rawPage) || Number(rawPage) > 1000) return json({ error: "Invalid auction filter or page." }, 400);
  const mine = search.get("mine") === "1";
  const session = mine ? await getCreatorSession(request) : null;
  if (mine && !session) return json({ error: "Sign in to see your auction drafts." }, 401);
  const page = Number(rawPage);
  const auctions = await prisma.assetAuction.findMany({
    where: { ...(kind ? { kind } : {}), ...(mine ? { sellerId: session!.userId } : { auctionId: { not: null } }) },
    select: assetAuctionPublicSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 24, take: 25,
  });
  return json({ auctions: auctions.slice(0, 24).map((auction) => publicAssetAuction(auction, mine ? true : undefined)), page, hasMore: auctions.length > 24 });
}

async function handlePOST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in before creating an auction." }, 401);
  if (!session.walletAddress) return json({ error: "Select a verified wallet linked to your signed-in account." }, 403);
  const limited = await protectAccount("submission", session.userId, "asset-auctions", request);
  if (limited) return limited;
  if (!protocol.isTestnet || !protocol.auctions) return json({ error: "The Arc Testnet auction house is not configured yet." }, 503);
  let details;
  try { details = validateAssetAuction(await limitedJson(request, 16_384)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid auction details." }, 400); }
  const cover = await prisma.uploadedImage.findUnique({ where: { id: details.imageUrl.slice("/api/uploads/".length) }, select: { ownerUserId: true, ownerWallet: true } });
  if (!cover || (cover.ownerUserId ? cover.ownerUserId !== session.userId : cover.ownerWallet?.toLowerCase() !== session.walletAddress.toLowerCase())) return json({ error: "The cover image must be an upload belonging to your account." }, 403);
  const now = new Date();
  const [draftCount, recentCount] = await Promise.all([
    prisma.assetAuction.count({ where: { sellerId: session.userId, auctionId: null, endsAt: { gt: now } } }),
    prisma.assetAuction.count({ where: { sellerId: session.userId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } }),
  ]);
  if (draftCount >= 20 || recentCount >= 30) return json({ error: "Auction creation limit reached. Publish your drafts or try again tomorrow." }, 429);
  const data = { ...details, id: randomUUID(), sellerId: session.userId, sellerWallet: session.walletAddress.toLowerCase(), marketAddress: protocol.auctions.toLowerCase(), chainId: 5042002 };
  const auction = await prisma.assetAuction.create({ data: { ...data, assetKey: assetAuctionCommitment(data) }, select: assetAuctionPublicSelect });
  return json({ auction: publicAssetAuction(auction, true) }, 201);
}

export const GET = withAbuseProtection("GET asset-auctions", "read", handleGET);
export const POST = withAbuseProtection("POST asset-auctions", "submission", handlePOST);
