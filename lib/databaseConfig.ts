/** Shared by the runtime and Prisma CLI. Never include connection URLs in errors. */
export function databaseConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  const url = env.DATABASE_URL || "file:./prisma/dev.db";
  if (url.startsWith("file:")) return { provider: "sqlite" as const, url, cliUrl: url, schema: "prisma/schema.sqlite.prisma" };
  if (!/^postgres(?:ql)?:\/\//.test(url)) throw new Error("DATABASE_URL must be a PostgreSQL connection string or a local SQLite file URL.");
  const cliUrl = env.DIRECT_URL || url;
  if (!/^postgres(?:ql)?:\/\//.test(cliUrl)) throw new Error("DIRECT_URL must be a PostgreSQL connection string.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("DATABASE_URL is not a valid PostgreSQL connection string."); }
  const schema = parsed.searchParams.get("schema") || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Choose a lowercase PostgreSQL schema identifier.");
  parsed.searchParams.delete("schema");
  return { provider: "postgresql" as const, url: parsed.href, cliUrl, schema: "prisma/schema.prisma", postgresSchema: schema };
}

export function postgresPoolConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  const max = Number(env.ARTIQ_DATABASE_POOL_SIZE || 5);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("ARTIQ_DATABASE_POOL_SIZE must be between 1 and 20.");
  return { max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000, statement_timeout: 15_000 };
}
