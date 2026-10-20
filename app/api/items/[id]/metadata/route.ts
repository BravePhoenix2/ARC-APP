import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicImageUrl } from "@/lib/itemMetadata";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const item = await prisma.item.findUnique({ where: { id: params.id }, select: { itemType: true, title: true, description: true, imageUrl: true, attributes: true } });
  if (!item || item.itemType !== "NFT") return NextResponse.json({ error: "NFT not found." }, { status: 404 });
  try {
    return NextResponse.json({ name: item.title, description: item.description || "", image: publicImageUrl(item.imageUrl), attributes: item.attributes || [] }, { headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "The app's public URL must be configured before metadata can be published." }, { status: 503 });
  }
}
