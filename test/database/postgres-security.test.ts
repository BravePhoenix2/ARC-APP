import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

test("ordered PostgreSQL migrations protect every application model from direct browser access", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const modelNames = Array.from(schema.matchAll(/^model (\w+) \{/gm), (match) => match[1]).sort();
  const migrationRoot = new URL("../../prisma/migrations/", import.meta.url);
  const migrationNames = readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const created = new Map<string, { migration: string; position: number }>();
  const protectedTables = new Map<string, Set<string>>();
  const protect = (table: string, privilege: string, migration: string, position: number) => {
    const creation = created.get(table);
    assert.ok(creation && (creation.migration < migration || creation.position < position), `${migration}: ${table} must exist before its protection is applied`);
    assert.ok(modelNames.includes(table), `${migration}: restrict privileges only for application tables`);
    const protections = protectedTables.get(table) ?? new Set<string>();
    protections.add(privilege);
    protectedTables.set(table, protections);
  };

  for (const name of migrationNames) {
    // Inspect executable SQL only, so documentation cannot satisfy a security check.
    const migration = readFileSync(new URL(`${name}/migration.sql`, migrationRoot), "utf8").replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, "");
    for (const match of migration.matchAll(/CREATE TABLE "(\w+)"/g)) created.set(match[1], { migration: name, position: match.index! });
    for (const match of migration.matchAll(/ALTER TABLE "(\w+)" ENABLE ROW LEVEL SECURITY/g)) protect(match[1], "rls", name, match.index!);
    for (const match of migration.matchAll(/REVOKE ALL PRIVILEGES ON TABLE "(\w+)" FROM PUBLIC/g)) protect(match[1], "public", name, match.index!);

    for (const block of migration.matchAll(/DO\s+\$(\w+)\$([\s\S]*?)\$\1\$/g)) {
      const sql = block[2];
      const tableArray = sql.match(/FOREACH app_table IN ARRAY ARRAY\[([\s\S]*?)\]/)?.[1];
      const tables = tableArray ? Array.from(tableArray.matchAll(/'([^']+)'/g), (match) => match[1]) : [];
      if (tables.length) {
        assert.match(sql, /EXECUTE format\('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', app_table\)/);
        assert.match(sql, /EXECUTE format\('REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC', app_table\)/);
        assert.match(sql, /EXECUTE format\('REVOKE ALL PRIVILEGES ON TABLE %I FROM %I', app_table, browser_role\)/);
        for (const table of tables) for (const privilege of ["rls", "public"]) protect(table, privilege, name, block.index!);
      }
      const directRoleRevokes = Array.from(sql.matchAll(/EXECUTE format\('REVOKE ALL PRIVILEGES ON TABLE "(\w+)" FROM %I', browser_role\)/g), (match) => match[1]);
      if (tables.length || directRoleRevokes.length) {
        assert.match(sql, /FOREACH browser_role IN ARRAY ARRAY\['anon', 'authenticated'\]/);
        assert.match(sql, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = browser_role\) THEN/);
        for (const table of [...tables, ...directRoleRevokes]) for (const role of ["anon", "authenticated"]) protect(table, role, name, block.index!);
      }
    }
    assert.doesNotMatch(migration, /CREATE POLICY|FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|ALL TABLES IN SCHEMA|public\./i, `${name}: preserve server-owner access and avoid unrelated/provider-owned tables`);
  }
  assert.deepEqual([...created.keys()].sort(), modelNames, "all canonical models must be created by the ordered migrations");
  assert.deepEqual([...protectedTables.keys()].sort(), modelNames, "adding a model requires protecting its direct database API too");
  for (const model of modelNames) assert.deepEqual([...protectedTables.get(model)!].sort(), ["anon", "authenticated", "public", "rls"], `${model} needs RLS and explicit PUBLIC/browser-role revokes`);
});
