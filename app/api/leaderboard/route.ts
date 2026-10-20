import { NextRequest, NextResponse } from "next/server";
import { getTesterLeaderboard } from "@/lib/testerLeaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const pageValue = request.nextUrl.searchParams.get("page");
  const sizeValue = request.nextUrl.searchParams.get("pageSize");
  if ((pageValue !== null && !/^\d{1,7}$/.test(pageValue)) || (sizeValue !== null && !/^\d{1,3}$/.test(sizeValue))) {
    return NextResponse.json({ error: "Choose a valid leaderboard page and page size." }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await getTesterLeaderboard({ page: pageValue ? Number(pageValue) : 1, pageSize: sizeValue ? Number(sizeValue) : 20 }), { headers });
  } catch {
    return NextResponse.json({ error: "The tester leaderboard is temporarily unavailable. Please try again." }, { status: 503, headers });
  }
}
