import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { NextRequest, NextResponse } from "next/server";
import type { Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { sameOrigin } from "@/lib/walletAuth";
import { getCreatorSession } from "@/lib/creatorSession";
import { limitedJson } from "@/lib/requestBody";
import { protocol } from "@/lib/protocol";
import { DeploymentVerificationError, verifiedCollection } from "@/lib/deploymentVerification";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  const session = await getCreatorSession(request);
  if (!session) return NextResponse.json({ error: "Sign in before linking a deployed collection." }, { status: 401, headers });
  const limited = await protectAccount("transaction", session.userId, "items/[id]/deployment", request);
  if (limited) return limited;
  if (!session.walletAddress) return NextResponse.json({ error: "Select a verified wallet linked to your sign-in before linking a deployment." }, { status: 403, headers });
  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404, headers });
  if (item.creatorId !== session.userId) return NextResponse.json({ error: "Only this collection's creator can link its deployment." }, { status: 403, headers });
  if (item.itemType !== "NFT") return NextResponse.json({ error: "Only NFT collections can link a deployment." }, { status: 400, headers });
  if (!protocol.isTestnet || !protocol.factory) return NextResponse.json({ error: "NFT deployment is not configured for Arc Testnet yet." }, { status: 503, headers });
  let body;
  try { body = await limitedJson(request, 4096); } catch { return NextResponse.json({ error: "Invalid deployment request." }, { status: 400, headers }); }
  if (!body || typeof body !== "object" || !("txHash" in body) || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) return NextResponse.json({ error: "Provide a valid deployment transaction hash." }, { status: 400, headers });
  try {
    const deployed = await verifiedCollection(item, body.txHash as Hash, protocol.factory);
    if (session.walletAddress.toLowerCase() !== deployed.creator.toLowerCase()) return NextResponse.json({ error: "The deployment wallet must match your signed-in wallet." }, { status: 403, headers });
    if (item.contractAddress && item.contractAddress.toLowerCase() !== deployed.address.toLowerCase()) return NextResponse.json({ error: "This collection already has a different contract. Its address cannot be replaced." }, { status: 409, headers });
    const current = await prisma.$transaction(async (tx) => {
      // This app only attaches Arc Testnet collections. Serialize lookup and
      // attachment so one contract cannot be claimed by two catalog items.
      const duplicate = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Item"
        WHERE "id" <> ${item.id} AND LOWER("contractAddress") = ${deployed.address.toLowerCase()}
        LIMIT 1
      `;
      if (duplicate.length) throw new Error("DUPLICATE_COLLECTION");
      await tx.item.updateMany({ where: { id: item.id, creatorId: session.userId, contractAddress: null, updatedAt: item.updatedAt, mintStartTime: item.mintStartTime }, data: { contractAddress: deployed.address, deploymentFactory: protocol.factory, status: item.mintStartTime && item.mintStartTime > new Date() ? "UPCOMING" : "LIVE" } });
      return tx.item.findUniqueOrThrow({ where: { id: item.id } });
    }, { isolationLevel: "Serializable" });
    if (!current.contractAddress) return NextResponse.json({ error: "Collection settings changed while verifying deployment. Refresh before trying again." }, { status: 409, headers });
    if (current.contractAddress?.toLowerCase() !== deployed.address.toLowerCase()) return NextResponse.json({ error: "Another deployment was linked first. Refresh this collection." }, { status: 409, headers });
    return NextResponse.json({ item: current }, { headers });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_COLLECTION") return NextResponse.json({ error: "This contract is already linked to another collection." }, { status: 409, headers });
    if (error instanceof DeploymentVerificationError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: "The deployment could not be verified on Arc. Wait for confirmation and try again." }, { status: 503, headers });
  }
}

export const POST = withAbuseProtection("POST items/[id]/deployment", "transaction", handlePOST);
