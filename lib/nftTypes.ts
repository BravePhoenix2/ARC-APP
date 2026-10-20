export const NFT_KINDS = ["COLLECTIBLE", "EDITION", "SOULBOUND", "MEMBERSHIP"] as const;

export type NftKind = typeof NFT_KINDS[number];
export type NftAttribute = { trait_type: string; value: string | number };

export const NFT_KIND_INFO: Record<NftKind, {
  label: string;
  standard: string;
  description: string;
  transferable: boolean;
}> = {
  COLLECTIBLE: {
    label: "Collectible",
    standard: "ERC-721",
    description: "Unique, individually numbered NFTs for art and collectibles.",
    transferable: true,
  },
  EDITION: {
    label: "Edition",
    standard: "ERC-1155",
    description: "Multiple copies of one token, sharing the same artwork and metadata.",
    transferable: true,
  },
  SOULBOUND: {
    label: "Soulbound",
    standard: "ERC-721 / ERC-5192",
    description: "A non-transferable token bound to its recipient, for credentials and achievements.",
    transferable: false,
  },
  MEMBERSHIP: {
    label: "Membership",
    standard: "ERC-721",
    description: "A transferable membership pass. Describe its access and benefits in the collection details.",
    transferable: true,
  },
};

export function isNftKind(value: unknown): value is NftKind {
  return typeof value === "string" && NFT_KINDS.includes(value as NftKind);
}
