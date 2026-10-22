import { withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to review applications." }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "Reviewer access is required." }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (status !== "PENDING" && status !== "APPROVED" && status !== "REJECTED") return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
  const submissions = await prisma.submission.findMany({
    where: { status }, include: { creator: { select: { walletAddress: true, email: true } }, collectionImages: { orderBy: { position: "asc" } } },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  return NextResponse.json({ submissions }, { headers: { "Cache-Control": "private, no-store" } });
}

export const GET = withAbuseProtection("GET admin/submissions", "read", handleGET);
