const { mkdirSync, openSync, closeSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

require("dotenv").config({ quiet: true });
require("dotenv").config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
if (url.startsWith("file:")) {
  const databasePath = resolve(url.slice(5));
  mkdirSync(dirname(databasePath), { recursive: true });
  // Prisma's schema engine needs an existing SQLite file in this setup.
  // Append mode creates a missing file while preserving an existing database.
  closeSync(openSync(databasePath, "a"));
}
