import assert from "node:assert/strict";
import { test } from "node:test";
import { browseItems, priceRangeError, type BrowseItem } from "../../lib/marketplaceBrowse";
const base: BrowseItem = { id: "base", itemType: "NFT", title: "Blue study", description: "Night skies", imageUrl: null, mintPriceUsdc: 0, priceUsdc: null, sold: false, status: "LIVE", creator: { username: "Nia", walletAddress: null } };
const items: BrowseItem[] = [
  { ...base, id: "free", createdAt: "2026-01-01", rarities: [{ name: "Rare", percentage: 20 }] },
  { ...base, id: "paid", title: "Red study", mintPriceUsdc: 25, status: "UPCOMING", mintStartTime: "2099-01-01", createdAt: "2026-02-01" },
  { ...base, id: "unknown", mintPriceUsdc: null, createdAt: "2026-03-01" },
  { ...base, id: "rug", itemType: "WEB2_ART", category: "RUG", priceUsdc: 50, status: null },
  { ...base, id: "painting", itemType: "WEB2_ART", category: "PAINTING", priceUsdc: 100, status: null, sold: true },
];
const ids = (result: BrowseItem[]) => result.map((item) => item.id);
test("marketplace combines search, price, status, category and rarity filters", () => {
  assert.deepEqual(ids(browseItems(items, { min: "0", max: "0", statuses: ["Live"], facets: ["Rare"], search: "nia blue" })), ["free"]);
  assert.deepEqual(ids(browseItems(items, { facets: ["Artistic rug"], statuses: ["Available"], min: "40", max: "60" })), ["rug"]);
  assert.deepEqual(ids(browseItems(items, { statuses: ["Sold"], facets: ["Painting"] })), ["painting"]);
  assert.deepEqual(ids(browseItems(items, { statuses: ["Upcoming"] })), ["paid"]);
  assert.deepEqual(ids(browseItems(items, { search: "not in catalog" })), []);
});
test("price sorting handles free mints and puts unknown prices last without mutating input", () => {
  const before = items.map((item) => item.id);
  assert.deepEqual(ids(browseItems(items, { sort: "Price: low to high" })), ["free", "paid", "rug", "painting", "unknown"]);
  assert.deepEqual(ids(browseItems(items, { sort: "Price: high to low" })), ["painting", "rug", "paid", "free", "unknown"]);
  assert.equal(browseItems(items, { sort: "Mint starting soon" })[0].id, "paid");
  assert.equal(browseItems(items, { sort: "Newest" })[0].id, "unknown");
  assert.deepEqual(items.map((item) => item.id), before);
});
test("invalid price ranges show an error rather than misleading results", () => {
  for (const [min, max] of [["-1", ""], ["bad", ""], ["1.1234567", ""], ["10", "1"]]) {
    assert.ok(priceRangeError(min, max)); assert.equal(browseItems(items, { min, max }).length, 0);
  }
  assert.equal(priceRangeError("0", "0"), null); assert.equal(priceRangeError("", ""), null);
});
