import { isAddress, type Address, type Hash, type PublicClient } from "viem";

export type RegistrationOperation = "collection-deployment" | "collection-creation-fee" | "art-listing";
export type TransactionRecoveryScope = {
  accountId: string;
  walletAddress: string;
  chainId: number;
  itemId: string;
  operation: RegistrationOperation;
};
export type PendingRegistration = { hash: Hash; contractAddress: Address; submittedAt: number };
const prefix = "artiq:pending-registration:v1:";

export function transactionRecoveryKey(scope: TransactionRecoveryScope): string {
  return prefix + JSON.stringify([scope.accountId, scope.walletAddress.toLowerCase(), scope.chainId, scope.itemId, scope.operation]);
}

export function readPendingRegistration(raw: string | null): PendingRegistration | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Partial<PendingRegistration>;
    if (typeof record.hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(record.hash) ||
      typeof record.contractAddress !== "string" || !isAddress(record.contractAddress) ||
      typeof record.submittedAt !== "number" || !Number.isFinite(record.submittedAt) || record.submittedAt < 0) return null;
    // Keep unresolved transactions until verified; expiring them could expose a
    // second deployment after an extended absence. No private form data is saved.
    return { hash: record.hash.toLowerCase() as Hash, contractAddress: record.contractAddress.toLowerCase() as Address, submittedAt: record.submittedAt };
  } catch { return null; }
}

/** A local hash is only a recovery hint. Server registration still verifies the full event/settings. */
export async function registrationReceipt(client: Pick<PublicClient, "getTransactionReceipt">, hash: Hash, wallet: string, contract: string) {
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.from.toLowerCase() !== wallet.toLowerCase()) throw new Error("This transaction belongs to a different wallet. Select the wallet that submitted it.");
  if (receipt.to?.toLowerCase() !== contract.toLowerCase()) throw new Error("This transaction was sent to a different contract. Enter the deployment or listing transaction hash.");
  return receipt;
}
