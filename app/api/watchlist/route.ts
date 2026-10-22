import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { publicCatalogSelect } from "@/lib/publicCatalog";
export const dynamic = "force-dynamic";
async function handleGET(request: NextRequest) {
  const session = await getCreatorSession(request);
  const headers = { "Cache-Control": "private, no-store" };
  if (!session) return NextResponse.json({ error: "Sign in to view your watchlist." }, { status: 401, headers });
  const saved = await prisma.watchlistEntry.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 500, select: { item: { select: publicCatalogSelect } } });
  return NextResponse.json({ ids: saved.map(({ item }) => item.id), items: saved.map(({ item }) => item) }, { headers });
}

export const GET = withAbuseProtection("GET watchlist", "read", handleGET);
