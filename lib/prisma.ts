import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { databaseConfiguration, postgresPoolConfiguration } from "@/lib/databaseConfig";

function createClient() {
  const database = databaseConfiguration();
  const adapter = database.provider === "postgresql"
    ? new PrismaPg({ connectionString: database.url, ...postgresPoolConfiguration(), options: `-c search_path=${database.postgresSchema}` }, { schema: database.postgresSchema })
    : new PrismaBetterSqlite3({ url: database.url });
  // Generate for the selected provider before running; both schemas share models.
  return new PrismaClient({ adapter });
}

// Standard Next.js dev singleton — without this, hot reload would create a
// fresh PrismaClient (and a fresh SQLite connection pool) on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
