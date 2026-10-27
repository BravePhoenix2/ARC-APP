import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSubmission, SubmissionValidationError } from "../../lib/submissionValidation";
import { NFT_KINDS, NFT_KIND_INFO } from "../../lib/nftTypes";

const application = {
  itemType: "NFT", creatorName: "Nia", title: "Night study",
  description: "A collection of hand-drawn night studies.",
  imageUrl: "https://example.com/night.png", priceUsdc: "2.5", maxSupply: 50,
};

test("legacy NFT applications remain valid and default to collectibles", () => {
  const input = parseSubmission(application);
  assert.equal(input.nftKind, "COLLECTIBLE");
  assert.equal(input.royaltyBps, 0);
  assert.equal(input.symbol, null);
  assert.equal(input.maxPerWallet, null);
  assert.deepEqual(input.attributes, []);
});

test("NFT applications cannot attach a supplied contract before deployment verification", () => {
  for (const contractAddress of ["0x1111111111111111111111111111111111111111", "not-an-address", 1, {}]) {
    assert.throws(() => parseSubmission({ ...application, contractAddress }), /without an existing contract address/);
  }
  for (const contractAddress of [undefined, null, ""]) assert.equal(parseSubmission({ ...application, contractAddress }).contractAddress, null);
});

test("image series require owned-upload URLs, ordered covers and one image per token", () => {
  const images = [{ imageUrl: "/api/uploads/abcdefghijklmnopqrstuvwx", filename: "001.png" }, { imageUrl: "/api/uploads/zyxwvutsrqponmlkjihgfedc", filename: "002.png" }];
  const body = { ...application, imageUrl: images[0].imageUrl, maxSupply: 2, images };
  assert.deepEqual(parseSubmission(body).images, images);
  for (const change of [{ maxSupply: 3 }, { nftKind: "EDITION" }, { metadataUri: "ipfs://custom/" }, { contractAddress: `0x${"1".repeat(40)}` }, { imageUrl: images[1].imageUrl }, { images: [images[0], images[0]] }, { images: [{ imageUrl: "https://example.com/1.png", filename: "1.png" }] }, { images: [{ ...images[0], filename: "../1.png" }] }, { images: Array(101).fill(images[0]) }]) assert.throws(() => parseSubmission({ ...body, ...change }), SubmissionValidationError);
});

test("all four NFT kinds normalize metadata, symbols, supply limits, and traits", () => {
  for (const nftKind of NFT_KINDS) {
    const input = parseSubmission({ ...application, nftKind, priceUsdc: "0", symbol: " night ", maxPerWallet: "2", royaltyBps: nftKind === "SOULBOUND" ? "0" : "750", metadataUri: " ipfs://bafyexample/metadata.json ", attributes: [{ trait_type: " Season ", value: " Winter " }, { trait_type: "Year", value: 2026 }] });
    assert.equal(input.nftKind, nftKind);
    assert.equal(input.symbol, "NIGHT");
    assert.equal(input.priceUsdc, 0, "NFT drops can be free");
    assert.equal(input.maxPerWallet, 2);
    assert.equal(input.metadataUri, "ipfs://bafyexample/metadata.json");
    assert.deepEqual(input.attributes, [{ trait_type: "Season", value: "Winter" }, { trait_type: "Year", value: 2026 }]);
  }
  assert.equal(NFT_KIND_INFO.EDITION.standard, "ERC-1155");
  assert.equal(NFT_KIND_INFO.SOULBOUND.transferable, false);
});

test("soulbound applications cannot claim transferability or resale royalties", () => {
  assert.equal(parseSubmission({ ...application, nftKind: "SOULBOUND" }).maxPerWallet, 1);
  assert.throws(() => parseSubmission({ ...application, nftKind: "SOULBOUND", royaltyBps: 1 }), /zero resale royalties/);
  assert.throws(() => parseSubmission({ ...application, nftKind: "SOULBOUND", transferable: true }), /cannot be transferable/);
});

test("malformed NFT settings are rejected instead of becoming unvalidated metadata", () => {
  for (const fields of [
    { nftKind: "ANYTHING" }, { symbol: "X" }, { symbol: "123TOKEN" }, { symbol: "TOO-LONG-SYMBOL" },
    { metadataUri: "javascript:alert(1)" }, { metadataUri: "http://example.com/metadata.json" },
    { metadataUri: "https://user:password@example.com/metadata.json" }, { metadataUri: "ipfs:///" },
    { maxPerWallet: 0 }, { maxPerWallet: 51 }, { maxPerWallet: "1.5" },
    { royaltyBps: -1 }, { royaltyBps: 1001 }, { royaltyBps: 0.5 },
    { attributes: {} }, { attributes: Array.from({ length: 21 }, () => ({ trait_type: "A", value: "B" })) },
    { attributes: [{ trait_type: "", value: "B" }] }, { attributes: [{ trait_type: "A".repeat(61), value: "B" }] },
    { attributes: [{ trait_type: "A", value: "B".repeat(121) }] }, { attributes: [{ trait_type: "A", value: {} }] },
    { attributes: [{ trait_type: "A", value: Number.POSITIVE_INFINITY }] },
  ]) assert.throws(() => parseSubmission({ ...application, ...fields }), SubmissionValidationError, JSON.stringify(fields));
});

test("NFT settings do not leak into ART BAZZAR and ART BAZZAR must retain a positive price", () => {
  const art = {
    ...application, itemType: "WEB2_ART", imageUrl: "/api/uploads/abcdefghijklmnopqrstuvwx",
    category: "PAINTING", creationMethod: "HUMAN", humanMadeDeclaration: true,
    creationProcess: "I painted the study using acrylic paint and brushes on canvas.",
    nftKind: "SOULBOUND", royaltyBps: 900, symbol: "ART", maxPerWallet: 5,
    metadataUri: "ipfs://example/art", attributes: [{ trait_type: "Type", value: "Painting" }],
  };
  const input = parseSubmission(art);
  assert.equal(input.nftKind, null);
  assert.equal(input.royaltyBps, null);
  assert.equal(input.symbol, null);
  assert.equal(input.metadataUri, null);
  assert.equal(input.maxPerWallet, null);
  assert.equal(input.attributes, undefined);
  assert.throws(() => parseSubmission({ ...art, priceUsdc: "0" }), /Price must be between 0.000001/);
});
