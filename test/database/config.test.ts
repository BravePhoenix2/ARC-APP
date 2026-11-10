import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { databaseConfiguration, postgresPoolConfiguration } from "../../lib/databaseConfig";
import { testnetConfigurationIssues } from "../../lib/testnetReadiness";

test("database selection keeps local SQLite and separates runtime and migration PostgreSQL connections", () => {
  assert.equal(databaseConfiguration({ DATABASE_URL: "file:/tmp/test.db" }).schema, "prisma/schema.sqlite.prisma");
  const db = databaseConfiguration({ DATABASE_URL: "postgresql://user:secret@pool.example/app?schema=artiq", DIRECT_URL: "postgresql://user:secret@direct.example/app?schema=artiq" });
  assert.equal(db.provider, "postgresql"); assert.equal(db.postgresSchema, "artiq");
  assert.equal(db.schema, "prisma/schema.prisma");
  assert.equal(new URL(db.url).searchParams.get("schema"), null);
  assert.ok(db.cliUrl.includes("direct.example"));
  assert.deepEqual(postgresPoolConfiguration({}), { max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 15000 });
  assert.throws(() => postgresPoolConfiguration({ ARTIQ_DATABASE_POOL_SIZE: "500" }));
  assert.throws(() => databaseConfiguration({ DATABASE_URL: "mysql://private-password@example/db" }), (error: Error) => !error.message.includes("private-password"));
});

test("SQLite companion contains exactly the canonical production model definitions", () => {
  const canonical = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const companion = readFileSync(new URL("../../prisma/schema.sqlite.prisma", import.meta.url), "utf8");
  assert.equal(companion, '// Generated from schema.prisma by scripts/sync-database-schemas.mjs.\n' + canonical.replace('provider = "postgresql"', 'provider = "sqlite"'));
});

test("public Testnet preflight rejects temporary origins and incomplete provider configuration", () => {
  const env = { NEXT_PUBLIC_APP_URL: "https://articmarket.xyz", ARTIQ_APP_ORIGIN: "https://articmarket.xyz", NEXT_PUBLIC_ARC_CHAIN_ID: "5042002", DATABASE_URL: "postgresql://local/app", NEXT_PUBLIC_PRIVY_APP_ID: "test-app", ARTIQ_ADMIN_EMAILS: "reviewer@example.com", ARTIQ_TRUSTED_PROXY: "cloudflare", NEXT_PUBLIC_SUPPORT_EMAIL: "support@example.com", NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT: "0x1111111111111111111111111111111111111111" };
  assert.deepEqual(testnetConfigurationIssues(env), []);
  assert.ok(testnetConfigurationIssues({ ...env, NEXT_PUBLIC_APP_URL: "https://preview.trycloudflare.com" }).some((issue) => issue.includes("permanent")));
  assert.ok(testnetConfigurationIssues({ ...env, DATABASE_URL: "file:./prisma/dev.db" }).some((issue) => issue.includes("PostgreSQL")));
  assert.ok(testnetConfigurationIssues({ ...env, ARTIQ_APP_ORIGIN: "https://old.example" }).some((issue) => issue.includes("match")));
  assert.ok(testnetConfigurationIssues({ ...env, ARTIQ_SECURITY_REDIS_URL: "https://redis.example" }).some((issue) => issue.includes("shared")));
  assert.ok(testnetConfigurationIssues({ ...env, FEE_RECIPIENT_ADDRESS: "invalid-server-override" }).some((issue) => issue.includes("creation fee wallet")), "an invalid preferred server wallet cannot hide behind a valid public fallback");
  assert.ok(testnetConfigurationIssues({ ...env, NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT: "0x0000000000000000000000000000000000000000" }).some((issue) => issue.includes("creation fee wallet")));
  assert.ok(testnetConfigurationIssues({ ...env, ARTIQ_AI_PIXEL_SCREENING: "true" }).some((issue) => issue.includes("Sightengine")));
  const vercel = { ...env, VERCEL: "1", ARTIQ_TRUSTED_PROXY: "vercel", ARTIQ_SECURITY_REDIS_URL: "https://redis.example", ARTIQ_SECURITY_REDIS_TOKEN: "test-token", ARTIQ_RATE_LIMIT_SECRET: "r".repeat(32), CRON_SECRET: "c".repeat(32) };
  assert.deepEqual(testnetConfigurationIssues(vercel), []);
  assert.ok(testnetConfigurationIssues({ ...vercel, CRON_SECRET: "" }).some((issue) => issue.includes("CRON_SECRET")));
  assert.ok(testnetConfigurationIssues({ ...env, VERCEL: "1" }).some((issue) => issue.includes("independently scaled")));
});
