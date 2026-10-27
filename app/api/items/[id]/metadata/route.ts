import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicImageUrl } from "@/lib/itemMetadata";
import { publicItemWhere } from "@/lib/publicCatalog";

export const dynamic = "force-dynamic";

async function handleGET(_request: NextRequest, { params: routeParams }: { params: Promise<{ id: string }> }) {
  const params = await routeParams;
  const item = await prisma.item.findFirst({ where: { AND: [{ id: params.id }, publicItemWhere] }, select: { itemType: true, title: true, description: true, imageUrl: true, attributes: true } });
  if (!item || item.itemType !== "NFT") return NextResponse.json({ error: "NFT not found." }, { status: 404 });
  try {
    return NextResponse.json({ name: item.title, description: item.description || "", image: publicImageUrl(item.imageUrl), attributes: item.attributes || [] }, { headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "The app's public URL must be configured before metadata can be published." }, { status: 503 });
  }
}

export const GET = withAbuseProtection("GET items/[id]/metadata", "read", handleGET);
