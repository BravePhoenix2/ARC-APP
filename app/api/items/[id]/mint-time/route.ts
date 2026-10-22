import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedJson } from "@/lib/requestBody";

// PATCH /api/items/[id]/mint-time
// Body: { mintStartTime: string (ISO date) }; creator comes from the signed session.
// A deployed collection's schedule is immutable, including before minting opens.
async function handlePATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in with email or your wallet." }, { status: 401 });
  const limited = await protectAccount("transaction", session.userId, "items/[id]/mint-time", request);
  if (limited) return limited;
  let body;
  try { body = await limitedJson(request, 4096); }
  catch { return NextResponse.json({ error: "Invalid mint schedule request." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !("mintStartTime" in body) || typeof body.mintStartTime !== "string" || body.mintStartTime.length > 64) {
    return NextResponse.json({ error: "mintStartTime must be a valid date string" }, { status: 400 });
  }

  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (item.itemType !== "NFT") {
    return NextResponse.json({ error: "Only NFT items have a mint time" }, { status: 400 });
  }
  if (session.userId !== item.creatorId) {
    return NextResponse.json({ error: "Only the creator can reschedule the mint time" }, { status: 403 });
  }
  if (await prisma.mintAccessPlan.findUnique({ where: { itemId: item.id } })) return NextResponse.json({ error: "Update all phase dates together in Mint access settings." }, { status: 409 });
  if (item.contractAddress) {
    return NextResponse.json({ error: "A deployed collection's mint time cannot be changed." }, { status: 409 });
  }
  const now = new Date();
  if ((item.status && item.status !== "UPCOMING") || (item.mintStartTime && item.mintStartTime <= now)) {
    return NextResponse.json({ error: "Minting has already started — cannot reschedule" }, { status: 409 });
  }

  const mintStartTime = new Date(body.mintStartTime);
  if (Number.isNaN(mintStartTime.getTime())) {
    return NextResponse.json({ error: "mintStartTime must be a valid date" }, { status: 400 });
  }
  if (mintStartTime <= now) {
    return NextResponse.json({ error: "mintStartTime must be in the future" }, { status: 400 });
  }

  const result = await prisma.item.updateMany({
    where: { id: item.id, creatorId: session.userId, contractAddress: null, mintAccessPlan: { is: null }, updatedAt: item.updatedAt, mintStartTime: item.mintStartTime },
    data: { mintStartTime },
  });
  if (result.count !== 1) {
    return NextResponse.json({ error: "This collection changed while saving its schedule. Refresh before trying again." }, { status: 409 });
  }
  const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });

  return NextResponse.json({ item: updated });
}

export const PATCH = withAbuseProtection("PATCH items/[id]/mint-time", "transaction", handlePATCH);
