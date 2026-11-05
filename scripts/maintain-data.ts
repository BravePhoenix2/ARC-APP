import { config } from "dotenv";

async function main() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => !["--apply", "--sessions-only", "--writes-paused"].includes(arg))) throw new Error("Usage: maintain-data.ts [--sessions-only] [--apply] [--writes-paused]");
  config({ path: ".env.local", quiet: true });
  const { prisma } = await import("@/lib/prisma");
  const { planDataRetention, applyDataRetention } = await import("@/lib/dataRetention");
  try {
    const plan = await planDataRetention(prisma, new Date(), args.has("--sessions-only"));
    console.log(JSON.stringify({
      mode: args.has("--apply") ? "apply" : "preview", cutoff: plan.cutoff.toISOString(), scannedUploads: plan.scanned,
      orphanUploads: plan.orphans.length, orphanBytes: plan.orphans.reduce((sum, image) => sum + image.byteSize, 0),
      expiredCredentials: plan.sessions.reduce((sum, rows) => sum + rows.length, 0), scanLimitReached: plan.scanLimitReached,
    }));
    if (args.has("--apply")) console.log(JSON.stringify(await applyDataRetention(prisma, plan, args.has("--writes-paused"))));
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => {
  // Never print driver/provider errors that can contain connection details.
  console.error(error instanceof Error && (error.message.startsWith("Usage:") || error.message.startsWith("Stop all")) ? error.message : "Data maintenance failed. Check database/storage availability and retry the preview.");
  process.exitCode = 1;
});
