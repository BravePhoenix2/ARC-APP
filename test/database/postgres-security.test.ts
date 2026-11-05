import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("every application model is protected by the server-only PostgreSQL migration", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../prisma/migrations/20261105010000_server_only_tables/migration.sql", import.meta.url), "utf8");
  const modelNames = Array.from(schema.matchAll(/^model (\w+) \{/gm), (match) => match[1]).sort();
  const protectedArray = migration.match(/FOREACH app_table IN ARRAY ARRAY\[([\s\S]*?)\]/)?.[1];
  assert.ok(protectedArray, "the privilege migration must explicitly scope its table set");
  const protectedNames = Array.from(protectedArray.matchAll(/'([^']+)'/g), (match) => match[1]).sort();
  assert.deepEqual(protectedNames, modelNames, "adding a model requires protecting its direct database API too");
  assert.match(migration, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC/);
  assert.match(migration, /ARRAY\['anon', 'authenticated'\]/);
  assert.match(migration, /FROM pg_roles WHERE rolname = browser_role/);
  assert.doesNotMatch(migration, /CREATE POLICY|FORCE ROW LEVEL SECURITY|ALL TABLES IN SCHEMA|public\./i, "preserve server-owner access and avoid unrelated/provider-owned tables");
});
