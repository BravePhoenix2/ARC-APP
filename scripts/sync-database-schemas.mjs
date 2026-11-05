import { readFileSync, writeFileSync } from "node:fs";

// Keep a single source of model definitions while retaining isolated SQLite tests.
const source = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
if (!source.includes('provider = "postgresql"')) throw new Error("Expected the canonical PostgreSQL datasource.");
const sqlite = '// Generated from schema.prisma by scripts/sync-database-schemas.mjs.\n' +
  source.replace('provider = "postgresql"', 'provider = "sqlite"');
const target = new URL("../prisma/schema.sqlite.prisma", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== sqlite) throw new Error("SQLite schema is stale. Run npm run db:generate.");
} else {
  writeFileSync(target, sqlite);
}
