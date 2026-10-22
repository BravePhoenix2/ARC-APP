import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { prisma } = await import("../lib/prisma");
  const { protocol } = await import("../lib/protocol");
  try {
    const nftWhere = { itemType: "NFT" as const, contractAddress: { not: null }, deploymentFactory: null };
    const artWhere = { itemType: "WEB2_ART" as const, artListingId: { not: null }, artMarketAddress: null };
    const [nfts, artworks] = await Promise.all([prisma.item.count({ where: nftWhere }), prisma.item.count({ where: artWhere })]);
    if (nfts && !protocol.factory) throw new Error("Configure the original studio factory before pinning existing collections.");
    if (artworks && !protocol.artMarket) throw new Error("Configure the original art market before pinning existing listings.");
    const [collections, art] = await prisma.$transaction([
      prisma.item.updateMany({ where: nftWhere, data: { deploymentFactory: protocol.factory } }),
      prisma.item.updateMany({ where: artWhere, data: { artMarketAddress: protocol.artMarket } }),
    ]);
    console.log(`Pinned ${collections.count} collections and ${art.count} art listings to their original contracts. You can now update the protocol configuration.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
