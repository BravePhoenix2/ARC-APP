import { withAbuseProtection } from "@/lib/abuseProtection";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const HOUR = 3_600_000;

// Only published Items qualify. Unreviewed submissions never enter this query.
// A cutoff gives every visitor the same selection throughout the hour.
const loadDrops = (cutoff: number) => prisma.item.findMany({
  where: { itemType: "NFT", createdAt: { lte: new Date(cutoff) } },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 4,
  select: { id: true, title: true, imageUrl: true, status: true },
});
const hourlyDrops = process.env.NODE_ENV === "production"
  ? unstable_cache(loadDrops, ["hourly-trending-drops-v1"], { revalidate: 3600 })
  : loadDrops;

async function handleGET() {
  const now = Date.now();
  const cutoff = Math.floor(now / HOUR) * HOUR;
  const nextAt = cutoff + HOUR;
  try {
    const items = await hourlyDrops(cutoff);
    return NextResponse.json({ items, nextAt: new Date(nextAt).toISOString() }, {
      headers: { "Cache-Control": `public, max-age=0, s-maxage=${Math.max(1, Math.floor((nextAt - Date.now()) / 1000))}` },
    });
  } catch {
    return NextResponse.json({ error: "Trending drops could not be loaded. Please try again." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

export const GET = withAbuseProtection("GET trending", "read", handleGET);
