import { config } from "dotenv";
config({ path: ".env.local" });
async function main() {
  const { prisma } = await import("../lib/prisma");
  const { protocol } = await import("../lib/protocol");
  try {
    if (!protocol.factory) throw new Error("Configure the original studio factory before pinning existing collections.");
    const result = await prisma.item.updateMany({ where: { itemType: "NFT", contractAddress: { not: null }, deploymentFactory: null }, data: { deploymentFactory: protocol.factory } });
    console.log(`Pinned ${result.count} existing collections to their original factory. You can now update the factory configuration.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
