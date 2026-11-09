import type { Prisma } from "@/lib/generated/prisma/client";
import { awardTesterMilestone } from "@/lib/testerLeaderboard";

type PublishableSubmission = Prisma.SubmissionGetPayload<{ include: { collectionImages: true } }>;

/** Called inside the same transaction that accepts a creator's submission. */
export async function publishSubmission(tx: Prisma.TransactionClient, application: PublishableSubmission) {
  const creator = await tx.user.update({ where: { id: application.creatorId }, data: { isCreator: true } });
  if (!creator.username) await tx.user.update({ where: { id: creator.id }, data: { username: application.creatorName } });
  const item = await tx.item.create({ data: {
    creatorId: application.creatorId, creationMethod: application.creationMethod, itemType: application.itemType, title: application.title,
    description: application.description, imageUrl: application.imageUrl,
    ...(application.itemType === "NFT" ? {
      nftKind: application.nftKind ?? "COLLECTIBLE", symbol: application.symbol,
      imageCount: application.imageCount,
      collectionImages: { create: application.collectionImages.map(({ position, filename, imageUrl }) => ({ position, filename, imageUrl })) },
      metadataUri: application.metadataUri, maxPerWallet: application.maxPerWallet,
      royaltyBps: application.nftKind === "SOULBOUND" ? 0 : application.royaltyBps,
      ...(application.attributes !== null ? { attributes: application.attributes as Prisma.InputJsonValue } : {}),
      mintPriceUsdc: application.priceUsdc, maxSupply: application.maxSupply,
      mintStartTime: application.mintStartTime, contractAddress: null,
      mintedCount: 0, status: "UPCOMING",
    } : { priceUsdc: application.priceUsdc, category: application.category, quantityAvailable: 1, sold: false }),
  } });
  await tx.submission.update({ where: { id: application.id }, data: { itemId: item.id } });
  await awardTesterMilestone(tx, application.creatorId, "APPROVED_CREATOR");
  return item;
}
