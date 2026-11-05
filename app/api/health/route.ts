import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAbuseProtection } from "@/lib/abuseProtection";

export const dynamic = "force-dynamic";

export const GET = withAbuseProtection("GET health", "read", async () => {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
});
