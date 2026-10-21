import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { museDay, museIndex, musePrompt } from "@/lib/dailyMuse";
export const dynamic = "force-dynamic";
export async function GET() {
  const { day, ordinal, nextAt } = museDay();
  try {
    const items = await prisma.$transaction(async (tx) => {
      const picks = [];
      for (const itemType of ["NFT", "WEB2_ART"] as const) {
        const where = { itemType, imageUrl: { not: null }, NOT: { imageUrl: "" } };
        const count = await tx.item.count({ where });
        if (!count) continue;
        const item = await tx.item.findFirst({ where, skip: museIndex(ordinal, count), orderBy: { id: "asc" }, select: {
          id: true, itemType: true, title: true, imageUrl: true,
          creator: { select: { id: true, username: true, walletAddress: true } },
        } });
        if (item) picks.push(item);
      }
      return picks;
    });
    return NextResponse.json({ day, nextAt, ...musePrompt(ordinal), items }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Today’s muse could not be loaded. Please try again." }, { status: 503 }); }
}
