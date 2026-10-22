import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function write(request: NextRequest, id: string, remove: boolean) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in to save items." }, 401);
  const limited = await protectAccount("interaction", session.userId, "watchlist/[id]", request);
  if (limited) return limited;
  if (!id || id.length > 200) return json({ error: "Invalid item." }, 400);
  if (remove) { await prisma.watchlistEntry.deleteMany({ where: { userId: session.userId, itemId: id } }); return json({ saved: false }); }
  if (!await prisma.item.findUnique({ where: { id }, select: { id: true } })) return json({ error: "Published item not found." }, 404);
  try {
    await prisma.$transaction(async (tx) => {
      const where = { userId_itemId: { userId: session.userId, itemId: id } };
      if (await tx.watchlistEntry.findUnique({ where })) return;
      if (await tx.watchlistEntry.count({ where: { userId: session.userId } }) >= 500) throw new Error("WATCHLIST_LIMIT");
      await tx.watchlistEntry.upsert({ where, create: { userId: session.userId, itemId: id }, update: {} });
    });
    return json({ saved: true });
  } catch (error) { return json({ error: error instanceof Error && error.message === "WATCHLIST_LIMIT" ? "Your watchlist holds up to 500 items. Remove an item first." : "Could not save this item. Please retry." }, error instanceof Error && error.message === "WATCHLIST_LIMIT" ? 409 : 503); }
}
async function handlePUT(request: NextRequest, { params }: { params: { id: string } }) { return write(request, params.id, false); }
async function handleDELETE(request: NextRequest, { params }: { params: { id: string } }) { return write(request, params.id, true); }

export const PUT = withAbuseProtection("PUT watchlist/[id]", "interaction", handlePUT);
export const DELETE = withAbuseProtection("DELETE watchlist/[id]", "interaction", handleDELETE);
