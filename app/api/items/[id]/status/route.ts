import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const NFT_STATUSES = ["UPCOMING", "LIVE", "MINTED_OUT", "LISTED"] as const;

// PATCH /api/items/[id]/status
// NFT items:      { status: "UPCOMING" | "LIVE" | "MINTED_OUT" | "LISTED" }
// WEB2_ART items:  { sold: boolean }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.itemType === "NFT") {
    if (!NFT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of ${NFT_STATUSES.join(", ")}` }, { status: 400 });
    }
    const updated = await prisma.item.update({ where: { id: params.id }, data: { status: body.status } });
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
