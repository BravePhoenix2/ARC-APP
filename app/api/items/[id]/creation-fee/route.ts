import { NextRequest, NextResponse } from "next/server";
import type { Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { getCreatorSession } from "@/lib/creatorSession";
import { sameOrigin } from "@/lib/walletAuth";
import { limitedJson } from "@/lib/requestBody";
import { protectAccount, withAbuseProtection } from "@/lib/abuseProtection";
import { COLLECTION_CREATION_FEE } from "@/lib/protocol";
import { COLLECTION_CREATION_FEE_CHAIN_ID, collectionCreationFeeData } from "@/lib/collectionCreationFee";
import { CollectionCreationPaymentError, getCollectionCreationFeeRecipient, getCollectionCreationPayment, recordCollectionCreationPayment } from "@/lib/collectionCreationPayment";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
type Context = { params: Promise<{ id: string }> };
type Payment = Awaited<ReturnType<typeof getCollectionCreationPayment>>;

function paymentStatus(itemId: string, payment: Payment, alreadyCreated = false) {
  const recipient = payment?.recipientWallet ?? (alreadyCreated ? null : getCollectionCreationFeeRecipient());
  return {
    paid: Boolean(payment) || alreadyCreated,
    requiresPayment: !payment && !alreadyCreated,
    alreadyCreated,
    amount: COLLECTION_CREATION_FEE.toString(), recipient,
    chainId: COLLECTION_CREATION_FEE_CHAIN_ID, paymentData: collectionCreationFeeData(itemId),
    payment: payment ? {
      txHash: payment.txHash, payerWallet: payment.payerWallet, recipientWallet: payment.recipientWallet,
      amount: payment.amount, chainId: payment.chainId, paidAt: payment.paidAt.toISOString(),
    } : null,
  };
}

function failure(error: unknown) {
  if (error instanceof CollectionCreationPaymentError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: "The creation payment could not be confirmed yet. Keep its transaction hash and retry verification without paying again.", code: "CREATION_PAYMENT_UNAVAILABLE" }, 503);
}

async function handleGET(request: NextRequest, { params }: Context) {
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in to view your collection creation payment." }, 401);
  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id }, select: { creatorId: true, itemType: true, contractAddress: true } });
  if (!item || item.creatorId !== session.userId || item.itemType !== "NFT") return json({ error: "Collection not found for this creator." }, 404);
  try {
    const payment = await getCollectionCreationPayment(id);
    if (payment && payment.ownerUserId !== session.userId) return json({ error: "Collection ownership changed. Its creation payment must be reviewed before continuing." }, 409);
    return json(paymentStatus(id, payment, Boolean(item.contractAddress)));
  }
  catch (error) { return failure(error); }
}

async function handlePOST(request: NextRequest, { params }: Context) {
  if (!sameOrigin(request)) return json({ error: "Invalid request origin." }, 403);
  const session = await getCreatorSession(request);
  if (!session) return json({ error: "Sign in to confirm a collection creation payment." }, 401);
  if (!session.walletAddress) return json({ error: "Select a verified wallet linked to your sign-in before confirming payment." }, 403);
  const limited = await protectAccount("transaction", session.userId, "items/[id]/creation-fee", request);
  if (limited) return limited;
  const { id } = await params;
  let body: unknown;
  try { body = await limitedJson(request, 4096); } catch { return json({ error: "Provide a valid creation payment transaction hash." }, 400); }
  if (!body || typeof body !== "object" || !("txHash" in body) || typeof body.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) return json({ error: "Provide a valid creation payment transaction hash." }, 400);
  try {
    const payment = await recordCollectionCreationPayment({ itemId: id, ownerUserId: session.userId, payerWallet: session.walletAddress, txHash: body.txHash as Hash });
    return json(paymentStatus(id, payment));
  } catch (error) { return failure(error); }
}

export const GET = withAbuseProtection("GET items/[id]/creation-fee", "read", handleGET);
export const POST = withAbuseProtection("POST items/[id]/creation-fee", "transaction", handlePOST);
