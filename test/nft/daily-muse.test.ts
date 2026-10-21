import assert from "node:assert/strict";
import { test } from "node:test";
import { museDay, museIndex, musePrompt, readMuseNotebook, stampMuse } from "../../lib/dailyMuse";
test("daily picks roll over at Lagos midnight even when the host uses another timezone", () => {
  const before = museDay(new Date("2026-10-21T22:59:59Z"));
  const after = museDay(new Date("2026-10-21T23:00:00Z"));
  assert.equal(before.day, "2026-10-21"); assert.equal(before.nextAt, "2026-10-21T23:00:00.000Z");
  assert.equal(after.day, "2026-10-22"); assert.equal(after.ordinal, before.ordinal + 1);
  for (const count of [2, 3, 9]) { assert.notEqual(museIndex(before.ordinal, count), museIndex(after.ordinal, count)); assert.equal(museIndex(before.ordinal, count), museIndex(before.ordinal, count)); }
  assert.equal(museIndex(10, 0), 0); assert.equal(museIndex(10, 1), 0);
  assert.notEqual(musePrompt(before.ordinal).theme, musePrompt(after.ordinal).theme);
});
test("a notebook counts a discovery day once, keeps both gallery discoveries, and retains nonconsecutive days", () => {
  let pages = stampMuse([], "2026-10-21", "nft-one");
  pages = stampMuse(pages, "2026-10-21", "nft-one");
  pages = stampMuse(pages, "2026-10-21", "art-one");
  assert.deepEqual(pages, [{ day: "2026-10-21", items: ["nft-one", "art-one"] }]);
  pages = stampMuse(pages, "2026-10-25", "nft-two");
  assert.equal(pages.length, 2); assert.equal(pages[0].day, "2026-10-21");
  assert.deepEqual(readMuseNotebook(JSON.parse(JSON.stringify(pages))), pages);
});
test("notebook restoration ignores malformed dates and records and limits storage growth", () => {
  assert.deepEqual(readMuseNotebook(null), []);
  assert.deepEqual(readMuseNotebook([{ day: "2026-02-30", items: ["bad"] }, { day: "nonsense", items: [] }, { day: "2026-10-21", items: [null, 3, "", "a".repeat(201)] }]), []);
  const pages = Array.from({ length: 1000 }, (_, i) => ({ day: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), items: ["one"] }));
  const restored = readMuseNotebook(pages);
  assert.equal(restored.length, 366);
  const repeated = stampMuse(restored, restored[365].day, "another");
  assert.equal(repeated.length, 366); assert.equal(repeated[0].day, restored[0].day);
});
