import { toFunctionSelector, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { factoryAbi, platformFeeAbi } from "@/lib/protocol";

export type PlatformFeeTerms = { legacy: boolean; bps: bigint; recipient: Address | null };
export type PlatformFeeClient = Pick<PublicClient, "readContract" | "getCode">;

/** Older studio factories create collections without a buyer mint surcharge. */
export async function readMintSurchargeBps(client: Pick<PublicClient, "readContract">, address: Address): Promise<bigint> {
  let supported: boolean;
  try { supported = await client.readContract({ address, abi: factoryAbi, functionName: "supportsMintSurcharge" }); }
  catch (error) {
    if (isMissingPlatformFeeInterface(error)) return BigInt(0);
    throw error;
  }
  if (!supported) return BigInt(0);
  // Once the capability is present, an unavailable rate is not a legacy term.
  const rate = await client.readContract({ address, abi: factoryAbi, functionName: "mintSurchargeBps" });
  if (rate < BigInt(0) || rate > BigInt(1000)) throw new Error("The deployed mint surcharge is invalid.");
  return rate;
}

/** A missing getter is different from an unavailable RPC or an application revert. */
export function isMissingPlatformFeeInterface(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const detail = error as { name?: string; raw?: string; reason?: string; data?: unknown; cause?: unknown };
    if (detail.name === "ContractFunctionZeroDataError") return true;
    if (detail.name === "ContractFunctionRevertedError" && !detail.data && (!detail.raw || detail.raw === "0x") && (!detail.reason || detail.reason === "execution reverted")) return true;
    error = detail.cause;
  }
  return false;
}

// Existing Artiq deployments are direct Solidity contracts. Inspect executable
// opcodes (excluding PUSH data and Solidity metadata), and never infer the
// implementation of a proxy from its dispatcher.
function isLegacyDirectDeployment(code: Hex): boolean {
  let hex = code.slice(2).toLowerCase();
  if (hex.length < 8) return false;
  const metadataBytes = parseInt(hex.slice(-4), 16);
  if (metadataBytes > 0 && (metadataBytes + 2) * 2 < hex.length) {
    const metadataStart = hex.length - (metadataBytes + 2) * 2;
    if (/^a[0-9a-f]/.test(hex.slice(metadataStart))) hex = hex.slice(0, metadataStart);
  }
  const selectors = new Set<string>();
  for (let offset = 0; offset < hex.length; offset += 2) {
    const opcode = parseInt(hex.slice(offset, offset + 2), 16);
    if (opcode === 0xf4 || opcode === 0xf2) return false;
    if (opcode === 0x63) selectors.add(hex.slice(offset + 2, offset + 10));
    if (opcode >= 0x60 && opcode <= 0x7f) offset += (opcode - 0x5f) * 2;
  }
  const selector = (signature: string) => toFunctionSelector(signature).slice(2).toLowerCase();
  if (selectors.has(selector("platformFeeBps()")) || selectors.has(selector("feeRecipient()"))) return false;
  return ["mintPrice()", "listings(uint256)", "nextAuctionId()", "collectionCreator(address)"].some((signature) => selectors.has(selector(signature)));
}

export async function readPlatformFeeTerms(client: PlatformFeeClient, address: Address): Promise<PlatformFeeTerms> {
  const results = await Promise.allSettled([
    client.readContract({ address, abi: platformFeeAbi, functionName: "platformFeeBps" }),
    client.readContract({ address, abi: platformFeeAbi, functionName: "feeRecipient" }),
  ]);
  const [rate, recipient] = results;
  if (rate.status === "fulfilled" && recipient.status === "fulfilled") {
    const bps = BigInt(rate.value);
    if (bps < BigInt(0) || bps > BigInt(1000) || (bps > BigInt(0) && recipient.value === zeroAddress)) throw new Error("The deployed platform fee configuration is invalid.");
    return { legacy: false, bps, recipient: recipient.value };
  }
  if (results.every((result) => result.status === "rejected" && isMissingPlatformFeeInterface(result.reason))) {
    const code = await client.getCode({ address });
    if (code && isLegacyDirectDeployment(code)) return { legacy: true, bps: BigInt(0), recipient: null };
  }
  throw rate.status === "rejected" ? rate.reason : recipient.status === "rejected" ? recipient.reason : new Error("Could not verify platform fees.");
}
