import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicCatalogSelect, publicItemWhere } from "@/lib/publicCatalog";
import { catalogCursor, catalogPagination } from "@/lib/catalogPagination";
import type { Prisma } from "@/lib/generated/prisma/client";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id.length > 200) return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  let pagination;
  try { pagination = catalogPagination(request.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const itemType = request.nextUrl.searchParams.get("itemType");
  if (itemType && itemType !== "NFT" && itemType !== "WEB2_ART") return NextResponse.json({ error: "itemType must be NFT or WEB2_ART." }, { status: 400 });
  const search = request.nextUrl.searchParams.get("search")?.trim() || "";
  if (search.length > 200) return NextResponse.json({ error: "Search must be under 201 characters." }, { status: 400 });

  const creator = await prisma.user.findFirst({ where: { id, items: { some: publicItemWhere } }, select: {
    id: true, username: true, avatarUrl: true, bio: true, walletAddress: true,
  } });
  if (!creator) return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  const { limit, after } = pagination;
  const creatorText = [creator.username, creator.walletAddress].filter(Boolean).join(" ").toLowerCase();
  const terms = search.toLowerCase().split(/\s+/).filter((term) => term && !creatorText.includes(term));
  const where: Prisma.ItemWhereInput = {
    creatorId: id,
    ...(itemType ? { itemType: itemType as "NFT" | "WEB2_ART" } : {}),
    AND: [
      publicItemWhere,
      ...terms.map((term) => ({ OR: [{ title: { contains: term } }, { description: { contains: term } }] })),
      ...(after ? [{ OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ] }] : []),
    ],
  };
  const [rows, totals] = await Promise.all([
    prisma.item.findMany({ where, select: publicCatalogSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }),
    prisma.item.groupBy({ by: ["itemType"], where: { creatorId: id, AND: [publicItemWhere] }, _count: { _all: true } }),
  ]);
  const items = rows.slice(0, limit);
  const count = (type: "NFT" | "WEB2_ART") => totals.find((entry) => entry.itemType === type)?._count._all || 0;
  return NextResponse.json({
    creator: { ...creator, items },
    counts: { publishedWorks: count("NFT") + count("WEB2_ART"), nftCollections: count("NFT"), artWorks: count("WEB2_ART") },
    nextCursor: rows.length > limit ? catalogCursor(items[items.length - 1]) : null,
  }, { headers: { "Cache-Control": "public, max-age=30" } });
}

export const GET = withAbuseProtection("GET creators/[id]", "read", handleGET);
