import { createPublicClient, getAddress, http, isAddress, zeroAddress, type Address, type Hash } from "viem";
import { prisma } from "@/lib/prisma";
import { arcChain } from "@/lib/arcConfig";
import { COLLECTION_CREATION_FEE } from "@/lib/protocol";
import { COLLECTION_CREATION_FEE_CHAIN_ID, collectionCreationFeeData } from "@/lib/collectionCreationFee";

export const collectionCreationPaymentClient = createPublicClient({
  chain: arcChain, transport: http(undefined, { timeout: 15_000, retryCount: 0 }),
});

export class CollectionCreationPaymentError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "INVALID_CREATION_PAYMENT") { super(message); }
}

/** Only server configuration chooses the platform wallet; request bodies never do. */
export function getCollectionCreationFeeRecipient(): Address {
  if (arcChain.id !== COLLECTION_CREATION_FEE_CHAIN_ID) throw new CollectionCreationPaymentError("Collection creation payments are available on Arc Testnet.", 503, "CREATION_PAYMENT_UNAVAILABLE");
  const value = process.env.FEE_RECIPIENT_ADDRESS?.trim() || process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT?.trim() || "";
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new CollectionCreationPaymentError("The collection creation fee wallet is not configured.", 503, "CREATION_PAYMENT_UNAVAILABLE");
  return getAddress(value);
}

export function getCollectionCreationPayment(itemId: string) {
  return prisma.collectionCreationPayment.findUnique({ where: { itemId } });
}

type PaymentInput = { itemId: string; ownerUserId: string; payerWallet: string; txHash: Hash };
const conflict = () => new CollectionCreationPaymentError("This collection already has a confirmed creation payment. Refresh its status instead of paying again.", 409, "CREATION_PAYMENT_ALREADY_RECORDED");

/** Verify the transfer before writing a durable, non-reusable collection credit. */
export async function recordCollectionCreationPayment(input: PaymentInput) {
  const { itemId, ownerUserId } = input;
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash) || !isAddress(input.payerWallet) || input.payerWallet.toLowerCase() === zeroAddress) throw new CollectionCreationPaymentError("Provide a valid creation payment transaction and verified wallet.");
  const txHash = input.txHash.toLowerCase() as Hash;
  const payerWallet = input.payerWallet.toLowerCase();
  const item = await prisma.item.findFirst({ where: { id: itemId, creatorId: ownerUserId, itemType: "NFT" }, select: { contractAddress: true } });
  if (!item) throw new CollectionCreationPaymentError("Only this collection's creator can confirm its payment.", 403);
  const existing = await getCollectionCreationPayment(itemId);
  if (existing) {
    if (existing.ownerUserId === ownerUserId && existing.txHash === txHash) return existing;
    throw conflict();
  }
  if (item.contractAddress) throw new CollectionCreationPaymentError("This collection has already been created. No creation payment is required.", 409);
  if (await prisma.collectionCreationPayment.findUnique({ where: { txHash } })) throw new CollectionCreationPaymentError("This payment is already assigned to another collection.", 409, "CREATION_PAYMENT_REUSED");
  const recipientWallet = getCollectionCreationFeeRecipient().toLowerCase();
  if (await collectionCreationPaymentClient.getChainId() !== COLLECTION_CREATION_FEE_CHAIN_ID) throw new CollectionCreationPaymentError("The creation payment must be verified on Arc Testnet.");
  const [transaction, receipt] = await Promise.all([
    collectionCreationPaymentClient.getTransaction({ hash: txHash }),
    collectionCreationPaymentClient.getTransactionReceipt({ hash: txHash }),
  ]);
  if (receipt.status !== "success") throw new CollectionCreationPaymentError("This creation payment reverted. No creation fee was received.", 400, "CREATION_PAYMENT_REVERTED");
  if (transaction.hash.toLowerCase() !== txHash || receipt.transactionHash.toLowerCase() !== txHash ||
      (transaction.chainId != null && transaction.chainId !== COLLECTION_CREATION_FEE_CHAIN_ID) || transaction.from.toLowerCase() !== payerWallet || receipt.from.toLowerCase() !== payerWallet ||
      transaction.to?.toLowerCase() !== recipientWallet || receipt.to?.toLowerCase() !== recipientWallet ||
      transaction.value !== COLLECTION_CREATION_FEE || transaction.input.toLowerCase() !== collectionCreationFeeData(itemId).toLowerCase()) {
    throw new CollectionCreationPaymentError("The transaction must pay exactly 5 test USDC from your verified wallet to the platform wallet for this collection.");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Recheck ownership after the RPC read; a transfer can never credit a
        // different account or a collection created while verification ran.
        const current = await tx.item.findFirst({ where: { id: itemId, creatorId: ownerUserId, itemType: "NFT" }, select: { contractAddress: true } });
        if (!current) throw new CollectionCreationPaymentError("Collection ownership changed while verifying payment. Refresh its status.", 409);
        const recorded = await tx.collectionCreationPayment.findUnique({ where: { itemId } });
        if (recorded) {
          if (recorded.ownerUserId === ownerUserId && recorded.txHash === txHash) return recorded;
          throw conflict();
        }
        if (current.contractAddress) throw new CollectionCreationPaymentError("This collection has already been created. No new creation payment is required.", 409);
        return tx.collectionCreationPayment.create({ data: {
          itemId, ownerUserId, txHash, payerWallet, recipientWallet,
          chainId: COLLECTION_CREATION_FEE_CHAIN_ID, amount: COLLECTION_CREATION_FEE.toString(),
        } });
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "P2002" && code !== "P2034") throw error;
      const recorded = await getCollectionCreationPayment(itemId);
      if (recorded) {
        if (recorded.ownerUserId === ownerUserId && recorded.txHash === txHash) return recorded;
        throw conflict();
      }
      if (await prisma.collectionCreationPayment.findUnique({ where: { txHash } })) throw new CollectionCreationPaymentError("This payment is already assigned to another collection.", 409, "CREATION_PAYMENT_REUSED");
      if (attempt === 2) throw error;
    }
  }
  throw new Error("CREATION_PAYMENT_WRITE_FAILED");
}
