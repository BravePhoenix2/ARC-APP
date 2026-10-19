import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";

// GET /api/items?itemType=NFT|WEB2_ART&status=LIVE&category=PAINTING&creator=0x...
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const itemType = params.get("itemType");
  const status = params.get("status");
  const category = params.get("category");
  const creatorWallet = params.get("creator");

  if (itemType && itemType !== "NFT" && itemType !== "WEB2_ART") {
    return NextResponse.json({ error: "itemType must be NFT or WEB2_ART" }, { status: 400 });
  }

  const where: Prisma.ItemWhereInput = {
    ...(itemType ? { itemType: itemType as "NFT" | "WEB2_ART" } : {}),
    ...(status ? { status: status as Prisma.ItemWhereInput["status"] } : {}),
    ...(category ? { category: category as Prisma.ItemWhereInput["category"] } : {}),
    ...(creatorWallet ? { creator: { walletAddress: creatorWallet } } : {}),
  };

  const items = await prisma.item.findMany({
    where,
    include: { creator: { select: { walletAddress: true, username: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ items });
}

// Public creation would bypass creator review. Publishing happens only when
// an authorized reviewer approves an application in /api/admin/submissions.
export async function POST() {
  return NextResponse.json(
    { error: "Apply through /api/submissions. Items are published after review." },
    { status: 405, headers: { Allow: "GET" } },
  );
}
