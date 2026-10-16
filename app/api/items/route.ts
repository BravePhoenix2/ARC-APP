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

// POST /api/items — create an NFT or WEB2_ART item.
// Body: { creatorWalletAddress, itemType, title, description?, imageUrl?, ...type-specific fields }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { creatorWalletAddress, itemType, title } = body;

  if (!creatorWalletAddress || typeof creatorWalletAddress !== "string") {
    return NextResponse.json({ error: "creatorWalletAddress is required" }, { status: 400 });
  }
  if (itemType !== "NFT" && itemType !== "WEB2_ART") {
    return NextResponse.json({ error: "itemType must be NFT or WEB2_ART" }, { status: 400 });
  }
  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const creator = await prisma.user.upsert({
    where: { walletAddress: creatorWalletAddress },
    update: {},
    create: { walletAddress: creatorWalletAddress, isCreator: true },
  });

  const common = {
    itemType,
    title,
    description: body.description ?? null,
    imageUrl: body.imageUrl ?? null,
    creatorId: creator.id,
  };

  const typeSpecific: Partial<Prisma.ItemCreateInput> =
    itemType === "NFT"
      ? {
          contractAddress: body.contractAddress ?? null,
          mintPriceUsdc: body.mintPriceUsdc ?? null,
          mintStartTime: body.mintStartTime ? new Date(body.mintStartTime) : null,
          maxSupply: body.maxSupply ?? null,
          mintedCount: 0,
          rarities: body.rarities ?? undefined,
          status: body.status ?? "UPCOMING",
        }
      : {
          category: body.category ?? null,
          priceUsdc: body.priceUsdc ?? null,
          quantityAvailable: body.quantityAvailable ?? null,
          sold: false,
        };

  const item = await prisma.item.create({
    data: { ...common, ...typeSpecific } as Prisma.ItemCreateInput,
  });

  return NextResponse.json({ item }, { status: 201 });
}
