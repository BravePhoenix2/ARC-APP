import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import { catalogPagination, catalogCursor } from "@/lib/catalogPagination";
import { publicCatalogSelect, publicItemWhere } from "@/lib/publicCatalog";
import { isNftKind } from "@/lib/nftTypes";

// GET /api/items?itemType=NFT|WEB2_ART&status=LIVE&category=PAINTING&creator=0x...
async function handleGET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let pagination;
  try { pagination = catalogPagination(params); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const { limit, after } = pagination;
  const itemType = params.get("itemType");
  const status = params.get("status");
  const category = params.get("category");
  const creatorWallet = params.get("creator");
  const nftKind = params.get("nftKind");

  if (itemType && itemType !== "NFT" && itemType !== "WEB2_ART") {
    return NextResponse.json({ error: "itemType must be NFT or WEB2_ART" }, { status: 400 });
  }
  if (nftKind && (!isNftKind(nftKind) || itemType === "WEB2_ART")) {
    return NextResponse.json({ error: "Choose a valid NFT type for NFT items." }, { status: 400 });
  }
  if (status && !["UPCOMING", "LIVE", "MINTED_OUT", "LISTED"].includes(status)) return NextResponse.json({ error: "Invalid NFT status." }, { status: 400 });
  if (category && !["PAINTING", "RUG", "COSMETIC", "OTHER"].includes(category)) return NextResponse.json({ error: "Invalid art category." }, { status: 400 });

  const where: Prisma.ItemWhereInput = {
    AND: [publicItemWhere],
    ...(itemType ? { itemType: itemType as "NFT" | "WEB2_ART" } : {}),
    ...(nftKind && isNftKind(nftKind) ? {
      // Pre-upgrade NFT entries are ordinary collectibles.
      itemType: "NFT" as const,
      ...(nftKind === "COLLECTIBLE" ? { OR: [{ nftKind }, { nftKind: null }] } : { nftKind }),
    } : {}),
    ...(status ? { status: status as Prisma.ItemWhereInput["status"] } : {}),
    ...(category ? { category: category as Prisma.ItemWhereInput["category"] } : {}),
    ...(creatorWallet ? { creator: { walletAddress: creatorWallet } } : {}),
  };

  const items = await prisma.item.findMany({
    where: after ? { AND: [where, { OR: [
      { createdAt: { lt: after.createdAt } },
      { createdAt: after.createdAt, id: { lt: after.id } },
    ] }] } : where,
    select: { ...publicCatalogSelect, nftKind: true, maxSupply: true, mintedCount: true, contractAddress: true, creationMethod: true, creatorId: true, symbol: true, maxPerWallet: true, royaltyBps: true, metadataUri: true, attributes: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  return NextResponse.json({ items: page, nextCursor: hasMore ? catalogCursor(page[page.length - 1]) : null }, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" },
  });
}

// Public creation would bypass creator review. Publishing happens only when
// an authorized reviewer approves an application in /api/admin/submissions.
async function handlePOST() {
  return NextResponse.json(
    { error: "Apply through /api/submissions. Items are published after review." },
    { status: 405, headers: { Allow: "GET" } },
  );
}

export const GET = withAbuseProtection("GET items", "read", handleGET);
export const POST = withAbuseProtection("POST items", "transaction", handlePOST);
