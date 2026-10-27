import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMyNfts, type MintedCollection } from "../../lib/myNfts";
import type { Address } from "viem";
const wallet = `0x${"1".repeat(40)}` as Address;
const collection = (id: string, digit: string): MintedCollection => ({ id, title: id, imageUrl: "/art.png", contractAddress: `0x${digit.repeat(40)}` });

test("mint history spans catalog pages, deduplicates contracts and retains transferred mints", async () => {
  const a = collection("a", "2"), b = collection("b", "3"), c = collection("c", "4");
  const pages: (string | null)[] = [];
  const reads: string[] = [];
  const result = await loadMyNfts(wallet, async (cursor) => {
    pages.push(cursor);
    return cursor ? { items: [a, b, c], nextCursor: null } : { items: [a, { ...a, contractAddress: null }], nextCursor: "next" };
  }, async (item, address) => {
    assert.equal(address, wallet); reads.push(item.id);
    return item.id === "a" ? { minted: BigInt(2), balance: BigInt(0) } : { minted: BigInt(0), balance: BigInt(3) };
  });
  assert.deepEqual(pages, [null, "next"]);
  assert.deepEqual(reads.sort(), ["a", "b", "c"]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].balance, BigInt(0));
  assert.deepEqual(result.failed, []);
});

test("unavailable collections are reported without hiding successful reads", async () => {
  const a = collection("a", "2"), b = collection("b", "3");
  const result = await loadMyNfts(wallet, async () => ({ items: [a, b], nextCursor: null }), async (item) => {
    if (item.id === "b") throw new Error("RPC offline");
    return { minted: BigInt(1), balance: BigInt(1) };
  });
  assert.equal(result.items[0].id, "a");
  assert.deepEqual(result.failed, [b]);
});

test("catalog failures reject rather than showing a misleading empty collection", async () => {
  await assert.rejects(loadMyNfts(wallet, async () => { throw new Error("Catalog unavailable"); }, async () => ({ minted: BigInt(0), balance: BigInt(0) })), /Catalog unavailable/);
});
