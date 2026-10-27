import { limitedJson } from "@/lib/requestBody";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";

const NFT_STATUSES = ["UPCOMING", "LIVE", "MINTED_OUT", "LISTED"] as const;

// PATCH /api/items/[id]/status
// NFT items:      { status: "UPCOMING" | "LIVE" | "MINTED_OUT" | "LISTED" }
// WEB2_ART items:  { sold: boolean }
async function handlePATCH(request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in with email or your wallet." }, { status: 401 });
  const limited = await protectAccount("transaction", session.userId, "items/[id]/status", request);
  if (limited) return limited;
  const body = await limitedJson(request, 4096).catch(() => null) as { status?: unknown; sold?: unknown } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const item = await prisma.item.findUnique({ where: { id: params.id }, include: { creator: true } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (!session.isAdmin && session.userId !== item.creatorId) {
    return NextResponse.json({ error: "Only the creator can update this item." }, { status: 403 });
  }

  if (item.itemType === "NFT") {
    if (!NFT_STATUSES.includes(body.status as typeof NFT_STATUSES[number])) {
      return NextResponse.json({ error: `status must be one of ${NFT_STATUSES.join(", ")}` }, { status: 400 });
    }
    if (item.nftKind === "SOULBOUND" && body.status === "LISTED") {
      return NextResponse.json({ error: "Soulbound NFTs are non-transferable and cannot be listed for resale." }, { status: 400 });
    }
    const updated = await prisma.item.update({ where: { id: params.id }, data: { status: body.status as typeof NFT_STATUSES[number] } });
    return NextResponse.json({ item: updated });
  }

  if (typeof body.sold !== "boolean") {
    return NextResponse.json({ error: "sold must be a boolean" }, { status: 400 });
  }
  const updated = await prisma.item.update({
    where: { id: params.id },
    data: { sold: body.sold, quantityAvailable: body.sold ? 0 : item.quantityAvailable },
  });
  return NextResponse.json({ item: updated });
}

export const PATCH = withAbuseProtection("PATCH items/[id]/status", "transaction", handlePATCH);
