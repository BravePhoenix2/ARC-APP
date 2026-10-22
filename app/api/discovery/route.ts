import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { museDay, museIndex, musePrompt } from "@/lib/dailyMuse";
export const dynamic = "force-dynamic";
const loadDailyPicks = async (_day: string, ordinal: number) => {
    return prisma.$transaction(async (tx) => {
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
};
const getDailyPicks = process.env.NODE_ENV === "production"
  ? unstable_cache(loadDailyPicks, ["daily-muse-picks-v1"], { revalidate: 60 })
  : loadDailyPicks;
export async function GET() {
  const { day, ordinal, nextAt } = museDay();
  try {
    const items = await getDailyPicks(day, ordinal);
    return NextResponse.json({ day, nextAt, ...musePrompt(ordinal), items }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" } });
  } catch { return NextResponse.json({ error: "Today’s muse could not be loaded. Please try again." }, { status: 503 }); }
}
