import assert from "node:assert/strict";
import { test } from "node:test";
import { guaranteedUltimateAllocation, collectionKey, hashPair, mintLeaf, mintTree, validateMintConfig } from "../../lib/mintAccess";
import { encodeAbiParameters, keccak256 } from "viem";
const wallets = ["1", "2", "3"].map((c) => `0x${c.repeat(40)}`);
const entries = wallets.map((walletAddress, i) => ({ walletAddress, tier: i === 0 ? "ULTIMATE" : "FCFS" }));
test("allowlist proofs match Solidity double-hashed domain-separated leaves, including odd leaves", () => {
  const tree = mintTree("collection", entries);
  for (const entry of entries) {
    const expected = keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "uint8" }], [collectionKey("collection"), entry.walletAddress as `0x${string}`, entry.tier === "ULTIMATE" ? 1 : 2])));
    assert.equal(mintLeaf("collection", entry.walletAddress, entry.tier), expected);
    assert.equal(tree.proof(entry.walletAddress, entry.tier).reduce(hashPair, expected), tree.root);
  }
  assert.equal(mintTree("collection", [...entries].reverse()).root, tree.root);
  assert.notEqual(mintTree("other", entries).root, tree.root);
  assert.throws(() => tree.proof(wallets[0], "FCFS"));
  assert.throws(() => mintTree("collection", [...entries, entries[0]]));
  assert.throws(() => mintTree("collection", []));
  const single = mintTree("single", entries.slice(0, 1)); assert.deepEqual(single.proof(wallets[0], "ULTIMATE"), []);
});
test("phase settings enforce ordered future windows, approved prices and global wallet cap", () => {
  const config = { ultimateStart: new Date(Date.now() + 3600000).toISOString(), fcfsStart: new Date(Date.now() + 7200000).toISOString(), publicStart: new Date(Date.now() + 10800000).toISOString(), ultimateLimit: 1, fcfsLimit: 2, publicLimit: 3, ultimatePrice: "0", fcfsPrice: "1" };
  assert.deepEqual(validateMintConfig(config, 3, 2), config);
  assert.throws(() => validateMintConfig({ ...config, publicLimit: 4 }, 3, 2));
  assert.throws(() => validateMintConfig({ ...config, fcfsPrice: "3" }, 3, 2));
  assert.throws(() => validateMintConfig({ ...config, fcfsStart: config.ultimateStart }, 3, 2));
  assert.throws(() => validateMintConfig({ ...config, ultimateStart: "invalid" }, 3, 2));
});


test("Ultimate guarantees cannot be oversubscribed when locking a roster", () => {
  const config = { ultimateLimit: 2 } as Parameters<typeof guaranteedUltimateAllocation>[1];
  assert.equal(guaranteedUltimateAllocation([{ tier: "ULTIMATE" }, { tier: "ULTIMATE" }, { tier: "FCFS" }, { tier: "PENDING" }], config, 4), 4);
  assert.throws(() => guaranteedUltimateAllocation([{ tier: "ULTIMATE" }, { tier: "ULTIMATE" }, { tier: "ULTIMATE" }], config, 4), /require 6 tokens/);
  assert.equal(guaranteedUltimateAllocation([{ tier: "FCFS" }], config, 4), 0);
});
