import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const Database = createRequire(import.meta.url)("better-sqlite3");
const { sqliteMigrationRows } = await import(new URL("../../scripts/sqlite-migration-rows.mjs", import.meta.url).href);

test("SQLite import reads collection payments without an id column and leaves the backup unchanged", () => {
  const directory = mkdtempSync(join(tmpdir(), "artiq-sqlite-import-"));
  const path = join(directory, "backup.db");
  const writable = new Database(path);
  writable.exec(`CREATE TABLE "CollectionCreationPayment" ("itemId" TEXT PRIMARY KEY, "txHash" TEXT, "amount" TEXT);
    INSERT INTO "CollectionCreationPayment" VALUES ('collection-z', 'transaction-z', '5000000000000000000');
    INSERT INTO "CollectionCreationPayment" VALUES ('collection-a', 'transaction-a', '5000000000000000000');`);
  writable.close();
  const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = digest();
  const source = new Database(path, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual([...sqliteMigrationRows(source, "CollectionCreationPayment", ["itemId", "txHash", "amount"])], [
      { itemId: "collection-a", txHash: "transaction-a", amount: "5000000000000000000" },
      { itemId: "collection-z", txHash: "transaction-z", amount: "5000000000000000000" },
    ]);
  } finally {
    source.close();
    assert.equal(digest(), before, "source iteration must not change the SQLite backup");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite import preserves id ordering and follows compound primary-key order", () => {
  const source = new Database(":memory:");
  try {
    source.exec(`CREATE TABLE "Item" ("id" TEXT PRIMARY KEY, "title" TEXT);
      INSERT INTO "Item" VALUES ('z', 'Last'), ('a', 'First');
      CREATE TABLE "Compound" ("position" INTEGER, "owner" TEXT, "value" TEXT, PRIMARY KEY ("owner", "position"));
      INSERT INTO "Compound" VALUES (1, 'z', 'third'), (2, 'a', 'second'), (1, 'a', 'first');`);
    assert.deepEqual([...sqliteMigrationRows(source, "Item", ["id", "title"])], [
      { id: "a", title: "First" }, { id: "z", title: "Last" },
    ]);
    assert.deepEqual([...sqliteMigrationRows(source, "Compound", ["owner", "position", "value"])], [
      { owner: "a", position: 1, value: "first" },
      { owner: "a", position: 2, value: "second" },
      { owner: "z", position: 1, value: "third" },
    ]);
  } finally { source.close(); }
});

test("SQLite import rejects a source table missing its primary key", () => {
  const source = new Database(":memory:");
  try {
    source.exec('CREATE TABLE "CollectionCreationPayment" ("itemId" TEXT)');
    assert.throws(() => sqliteMigrationRows(source, "CollectionCreationPayment", ["itemId"]), /Missing source primary key for CollectionCreationPayment/);
  } finally { source.close(); }
});
