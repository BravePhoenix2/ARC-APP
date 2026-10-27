import type { Prisma } from "@/lib/generated/prisma/client";

/** Imported addresses supplied in old applications never established provenance. */
export const publicItemWhere = {
  NOT: { itemType: "NFT", submission: { is: { contractAddress: { not: null } } } },
} satisfies Prisma.ItemWhereInput;

/** Shared public projection: no emails, private submissions, or delivery records. */
export const publicCatalogSelect = {
  id: true, itemType: true, title: true, description: true, imageUrl: true,
  mintPriceUsdc: true, priceUsdc: true, status: true, category: true, sold: true,
  createdAt: true, mintStartTime: true, rarities: true,
  creator: { select: { id: true, username: true, walletAddress: true } },
} as const;
