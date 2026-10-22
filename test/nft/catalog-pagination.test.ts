import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogCursor, catalogPagination } from "../../lib/catalogPagination";

test("catalog bounds database result sizes", () => {
  assert.equal(catalogPagination(new URLSearchParams()).limit, 48);
  for (const limit of ["0", "-1", "101", "Infinity", "1.5", "bad", ""]) {
    assert.throws(() => catalogPagination(new URLSearchParams({ limit })));
  }
  assert.equal(catalogPagination(new URLSearchParams({ limit: "100" })).limit, 100);
});

test("catalog cursor retains the timestamp and tie breaker without a database lookup", () => {
  const item = { id: "item_123", createdAt: new Date("2026-10-22T00:00:00.000Z") };
  assert.deepEqual(catalogPagination(new URLSearchParams({ cursor: catalogCursor(item) })).after, item);
  for (const cursor of ["invalid", "x".repeat(513), Buffer.from(JSON.stringify({ id: "a", createdAt: "invalid" })).toString("base64url")]) {
    assert.throws(() => catalogPagination(new URLSearchParams({ cursor })));
  }
});
