import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchesRequestWallet } from "@/lib/requestWallet";
import { getWalletSession } from "@/lib/walletAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getWalletSession(request);
  if (!session || !matchesRequestWallet(request, session)) return NextResponse.json({ error: "Sign in to review applications." }, { status: 401 });
  if (!session.isAdmin) return NextResponse.json({ error: "Reviewer access is required." }, { status: 403 });
  const status = request.nextUrl.searchParams.get("status") ?? "PENDING";
  if (status !== "PENDING" && status !== "APPROVED" && status !== "REJECTED") return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
  const submissions = await prisma.submission.findMany({
    where: { status }, include: { creator: { select: { walletAddress: true, email: true } } },
    orderBy: { createdAt: "asc" }, take: 100,
  });
  return NextResponse.json({ submissions }, { headers: { "Cache-Control": "private, no-store" } });
}
