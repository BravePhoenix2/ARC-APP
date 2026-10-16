import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// PATCH /api/items/[id]/mint-time
// Body: { mintStartTime: string (ISO date), requesterWalletAddress: string }
// Only the item's creator may reschedule, and only before minting has begun.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (!body?.mintStartTime) {
    return NextResponse.json({ error: "mintStartTime is required" }, { status: 400 });
  }

  const item = await prisma.item.findUnique({ where: { id: params.id }, include: { creator: true } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.itemType !== "NFT") {
    return NextResponse.json({ error: "Only NFT items have a mint time" }, { status: 400 });
  }
  if (body.requesterWalletAddress && body.requesterWalletAddress !== item.creator.walletAddress) {
    return NextResponse.json({ error: "Only the creator can reschedule the mint time" }, { status: 403 });
  }
  if (item.status && item.status !== "UPCOMING") {
    return NextResponse.json({ error: "Minting has already started — cannot reschedule" }, { status: 409 });
  }

  const mintStartTime = new Date(body.mintStartTime);
  if (Number.isNaN(mintStartTime.getTime())) {
    return NextResponse.json({ error: "mintStartTime must be a valid date" }, { status: 400 });
  }

  const updated = await prisma.item.update({
    where: { id: params.id },
    data: { mintStartTime },
  });

  return NextResponse.json({ item: updated });
}
