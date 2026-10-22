import { withAbuseProtection } from "@/lib/abuseProtection";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getTesterLeaderboard } from "@/lib/testerLeaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const publicHeaders = { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=30" };
const loadLeaderboard = (page: number, pageSize: number) => getTesterLeaderboard({ page, pageSize });
const cachedLeaderboard = process.env.NODE_ENV === "production"
  ? unstable_cache(loadLeaderboard, ["tester-leaderboard-v1"], { revalidate: 30 })
  : loadLeaderboard;

async function handleGET(request: NextRequest) {
  const pageValue = request.nextUrl.searchParams.get("page");
  const sizeValue = request.nextUrl.searchParams.get("pageSize");
  if ((pageValue !== null && !/^\d{1,7}$/.test(pageValue)) || (sizeValue !== null && !/^\d{1,3}$/.test(sizeValue))) {
    return NextResponse.json({ error: "Choose a valid leaderboard page and page size." }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await cachedLeaderboard(pageValue ? Number(pageValue) : 1, sizeValue ? Number(sizeValue) : 20), { headers: publicHeaders });
  } catch {
    return NextResponse.json({ error: "The tester leaderboard is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}

export const GET = withAbuseProtection("GET leaderboard", "read", handleGET);
