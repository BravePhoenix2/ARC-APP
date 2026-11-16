import type { Prisma } from "@/lib/generated/prisma/client";

/** Imported addresses supplied in old applications never established provenance. */
export const publicItemWhere = {
  NOT: { itemType: "NFT", submission: { is: { contractAddress: { not: null } } } },
} satisfies Prisma.ItemWhereInput;

/** Shared public projection: no emails, private submissions, or delivery records. */
export const publicCatalogSelect = {
  id: true, itemType: true, title: true, description: true, imageUrl: true,
  mintPriceUsdc: true, priceUsdc: true, status: true, category: true, sold: true,
  createdAt: true, mintStartTime: true, rarities: true, contractAddress: true,
  creator: { select: { id: true, username: true, walletAddress: true } },
} as const;

/** Cards need launch/supply data, but not the collection's deployment metadata. */
export const publicCatalogCardSelect = {
  ...publicCatalogSelect,
  nftKind: true, maxSupply: true, mintedCount: true, creationMethod: true,
} as const;
