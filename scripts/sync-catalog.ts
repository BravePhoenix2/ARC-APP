import { config as loadEnv } from "dotenv";

async function main() {
  loadEnv({ path: ".env.local", quiet: true });

  // A bounded external scheduler can run this command once a minute. Provider and
  // database URLs remain server-side; no public cron mutation endpoint is needed.
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--limit", "--cursor"].includes(args[index]) || !args[index + 1]) throw new Error("Usage: catalog:sync [--limit 1..1000] [--cursor item-id]");
    options.set(args[index], args[index + 1]);
  }
  const limit = Number(options.get("--limit") || "250");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Catalog sync limit must be from 1 to 1000.");
  const { reconcileCatalogPage } = await import("../lib/catalogSync");
  const { prisma } = await import("../lib/prisma");
  let after = options.get("--cursor");
  let checked = 0;
  let failed = 0;
  let incomplete = false;
  const deadline = Date.now() + 45_000;
  try {
    do {
      const page = await reconcileCatalogPage({ limit: Math.min(50, limit - checked), after, deadline });
      checked += page.results.length;
      failed += page.results.filter((result) => !result.ok).length;
      incomplete = page.hasMore;
      for (const result of page.results) if (!result.ok) console.error(JSON.stringify(result));
      after = page.nextCursor || undefined;
    } while (after && checked < limit && Date.now() < deadline);
    console.log(JSON.stringify({ checked, failed, incomplete, nextCursor: after || null }));
    if (failed || incomplete) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Catalog sync failed. Check the server database/Arc configuration and command arguments; no client-supplied availability was saved."); process.exitCode = 1; });
