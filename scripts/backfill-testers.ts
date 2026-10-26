import { config } from "dotenv";

async function main() {
  config({ path: ".env.local", quiet: true });
  const { backfillVerifiedTesters } = await import("@/lib/testerLeaderboard");
  const { prisma } = await import("@/lib/prisma");
  try {
    const { imported } = await backfillVerifiedTesters();
    console.log(`Added ${imported} previously verified tester accounts. Seeded profiles are excluded.`);
  }
  finally {
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error("Tester backfill failed. Existing accounts have not been reset."); process.exitCode = 1; });
