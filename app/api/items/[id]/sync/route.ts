import { NextRequest, NextResponse } from "next/server";
import { isAddress, type Address, type Hash } from "viem";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { CatalogSyncBusyError, CatalogSyncError, syncConfirmedCatalogAction } from "@/lib/catalogSync";
import { getCreatorSession } from "@/lib/creatorSession";
import { prisma } from "@/lib/prisma";
import { publicItemWhere } from "@/lib/publicCatalog";
import { limitedJson } from "@/lib/requestBody";
import { sameOrigin } from "@/lib/walletAuth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in to verify this transaction." }, { status: 401, headers });
  const limited = await protectAccount("transaction", session.userId, "items/[id]/sync", request);
  if (limited) return limited;
  if (!session.walletAddress || !isAddress(session.walletAddress)) return NextResponse.json({ error: "Select a verified wallet linked to your sign-in." }, { status: 403, headers });
  const body = await limitedJson(request, 4096).catch(() => null) as { txHash?: unknown } | null;
  if (!body || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) return NextResponse.json({ error: "Provide a confirmed transaction hash." }, { status: 400, headers });
  const { id } = await params;
  const item = await prisma.item.findFirst({ where: { id, AND: [publicItemWhere] } });
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404, headers });
  try {
    const availability = await syncConfirmedCatalogAction(item, body.txHash as Hash, session.walletAddress as Address);
    return NextResponse.json({ item: availability }, { headers });
  } catch (error) {
    if (error instanceof CatalogSyncBusyError) return NextResponse.json({ error: error.message }, { status: 429, headers: { ...headers, "Retry-After": "2" } });
    if (error instanceof CatalogSyncError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: "The transaction may be confirmed, but catalog verification is unavailable. Retry the check; do not pay again." }, { status: 503, headers });
  }
}
export const POST = withAbuseProtection("POST items/[id]/sync", "transaction", handlePOST);
