import { isAddress, zeroAddress, type Address, type Hash } from "viem";
export const deploymentKeys = ["factory", "artMarket", "auctions"] as const;
export type DeploymentKey = typeof deploymentKeys[number];
export type StudioDeployment = Partial<Record<DeploymentKey, Address>> & { pending?: { key: DeploymentKey; hash: Hash } };
export function readDeploymentDraft(value: unknown): StudioDeployment {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const draft: StudioDeployment = {};
  for (const key of deploymentKeys) if (typeof input[key] === "string" && isAddress(input[key]) && input[key].toLowerCase() !== zeroAddress) draft[key] = input[key] as Address;
  const pending = input.pending as { key?: DeploymentKey; hash?: unknown } | undefined;
  if (pending && deploymentKeys.includes(pending.key!) && typeof pending.hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(pending.hash) && !draft[pending.key!]) draft.pending = { key: pending.key!, hash: pending.hash as Hash };
  return draft;
}
/** An incomplete draft must never look like deployable application configuration. */
export function deploymentConfiguration(draft: StudioDeployment): string | null {
  const valid = readDeploymentDraft(draft);
  if (!valid.factory || !valid.artMarket || !valid.auctions || valid.pending) return null;
  return `NEXT_PUBLIC_STUDIO_FACTORY_ADDRESS=${valid.factory}\nNEXT_PUBLIC_ART_MARKET_ADDRESS=${valid.artMarket}\nNEXT_PUBLIC_AUCTION_HOUSE_ADDRESS=${valid.auctions}`;
}
