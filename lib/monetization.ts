import { isAddress, zeroAddress, type Address } from "viem";

export type FeeTerms = { feeRecipient: Address; mintFeeBps: number; marketplaceFeeBps: number };
export const feePresets = {
  standard: { mintFeeBps: 250, marketplaceFeeBps: 250 },
  opensea: { mintFeeBps: 1000, marketplaceFeeBps: 100 },
} as const;

export function readFeeTerms(value: unknown): FeeTerms | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.feeRecipient !== "string" || !isAddress(input.feeRecipient) || input.feeRecipient.toLowerCase() === zeroAddress) return null;
  for (const key of ["mintFeeBps", "marketplaceFeeBps"]) {
    if (typeof input[key] !== "number" || !Number.isInteger(input[key]) || input[key] < 0 || input[key] > 1000) return null;
  }
  return { feeRecipient: input.feeRecipient as Address, mintFeeBps: input.mintFeeBps as number, marketplaceFeeBps: input.marketplaceFeeBps as number };
}

export function percentToBps(value: string): number {
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a fee from 0% to 10% with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 1000) throw new Error("Platform fees cannot exceed 10%.");
  return bps;
}
