import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicCatalogSelect } from "@/lib/publicCatalog";
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (params.id.length > 200) return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  const creator = await prisma.user.findFirst({ where: { id: params.id, items: { some: {} } }, select: {
    id: true, username: true, avatarUrl: true, bio: true, walletAddress: true,
    items: { select: publicCatalogSelect, orderBy: { createdAt: "desc" } },
  } });
  if (!creator) return NextResponse.json({ error: "Creator not found." }, { status: 404 });
  return NextResponse.json({ creator }, { headers: { "Cache-Control": "public, max-age=30" } });
}
