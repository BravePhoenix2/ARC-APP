import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creatorSession";
import { securitySnapshot, withAbuseProtection } from "@/lib/abuseProtection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
async function handleGET(request: NextRequest) {
  const session = await getCreatorSession(request, false);
  if (!session) return NextResponse.json({ error: "Sign in to view request protection." }, { status: 401, headers });
  if (!session.isAdmin) return NextResponse.json({ error: "Reviewer access is required." }, { status: 403, headers });
  return NextResponse.json(await securitySnapshot(), { headers });
}
export const GET = withAbuseProtection("GET admin/security", "read", handleGET);
