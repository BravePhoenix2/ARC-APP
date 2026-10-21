import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicImageUrl } from "@/lib/itemMetadata";

export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, { params }: { params: { id: string; tokenId: string } }) {
  if (!/^[1-9]\d{0,6}$/.test(params.tokenId)) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  const position = Number(params.tokenId);
  const item = await prisma.item.findUnique({ where: { id: params.id }, select: { itemType: true, title: true, description: true, attributes: true, imageCount: true, collectionImages: { where: { position }, take: 1 } } });
  const image = item?.collectionImages[0];
  if (!item || item.itemType !== "NFT" || item.imageCount < 2 || !image) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  try {
    return NextResponse.json({ name: `${item.title} #${position}`, description: item.description || "", image: publicImageUrl(image.imageUrl), attributes: item.attributes || [] }, { headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Configure the public app URL before publishing metadata." }, { status: 503 }); }
}
