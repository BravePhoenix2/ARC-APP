import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creatorSession";
import { getTesterEntry } from "@/lib/testerLeaderboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await getCreatorSession(request);
    if (!session) return NextResponse.json({ error: "Sign in to view your tester progress." }, { status: 401, headers });
    return NextResponse.json({ tester: await getTesterEntry(session.userId) }, { headers });
  } catch {
    return NextResponse.json({ error: "Your tester progress is temporarily unavailable." }, { status: 503, headers });
  }
}
