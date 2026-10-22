import { isAddress, zeroAddress, type Address, type Hash } from "viem";
import { readFeeTerms, type FeeTerms } from "./monetization";
export const deploymentKeys = ["factory", "artMarket", "auctions"] as const;
export type DeploymentKey = typeof deploymentKeys[number];
export type StudioDeployment = Partial<Record<DeploymentKey, Address>> & { fees?: FeeTerms; pending?: { key: DeploymentKey; hash: Hash } };
export function readDeploymentDraft(value: unknown): StudioDeployment {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const draft: StudioDeployment = {};
  const fees = readFeeTerms(input.fees);
  if (!fees) return draft;
  draft.fees = fees;
  for (const key of deploymentKeys) if (typeof input[key] === "string" && isAddress(input[key]) && input[key].toLowerCase() !== zeroAddress) draft[key] = input[key] as Address;
  const pending = input.pending as { key?: DeploymentKey; hash?: unknown } | undefined;
  if (pending && deploymentKeys.includes(pending.key!) && typeof pending.hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(pending.hash) && !draft[pending.key!]) draft.pending = { key: pending.key!, hash: pending.hash as Hash };
  return draft;
}
/** An incomplete draft must never look like deployable application configuration. */
export function deploymentConfiguration(draft: StudioDeployment, legacyAuctions: Address[] = []): string | null {
  if (draft.pending) return null;
  const valid = readDeploymentDraft(draft);
  if (!valid.factory || !valid.artMarket || !valid.auctions || valid.pending || !valid.fees) return null;
  const previous = Array.from(new Set(legacyAuctions.filter((address) => isAddress(address) && address.toLowerCase() !== valid.auctions!.toLowerCase() && address.toLowerCase() !== zeroAddress).map((address) => address.toLowerCase())));
  return `NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${valid.factory}\nNEXT_PUBLIC_ART_MARKET_ADDRESS=${valid.artMarket}\nNEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${valid.auctions}\nNEXT_PUBLIC_PLATFORM_FEE_RECIPIENT=${valid.fees.feeRecipient}\nFEE_RECIPIENT_ADDRESS=${valid.fees.feeRecipient}\nMINT_FEE_BPS=${valid.fees.mintFeeBps}\nMARKETPLACE_FEE_BPS=${valid.fees.marketplaceFeeBps}\nNEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES=${previous.join(",")}`;
}
