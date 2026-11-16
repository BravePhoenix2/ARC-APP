import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as reactQuery from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";

const directory = mkdtempSync(join(tmpdir(), "artiq-creator-pagination-"));
process.env.DATABASE_URL = `file:${join(directory, "catalog.db")}`;
delete process.env.ARTIQ_TRUSTED_PROXY;
delete process.env.ARTIQ_SECURITY_REDIS_URL;
let db: typeof import("../../lib/prisma")["prisma"];
let profile: typeof import("../../app/api/creators/[id]/route");
let creatorId: string;
let unpublishedId: string;
let quarantinedId: string;
let importOnlyCreatorId: string;
let privateImageId: string;
let ownerCookie: string;
const wallet = "0x1111111111111111111111111111111111111111";
const records = Array.from({ length: 105 }, (_, index) => ({
  id: `creator_work_${String(index).padStart(3, "0")}`,
  itemType: index < 60 ? "NFT" as const : "WEB2_ART" as const,
  title: index === 104 ? "Oldest magenta print" : `Public work ${index}`,
  description: index === 104 ? "A quiet portrait" : null,
  createdAt: new Date(index === 104 ? "2026-01-01" : "2026-10-20"),
}));

before(async () => {
  writeFileSync(join(directory, "catalog.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push"], { env: process.env, stdio: "pipe" });
  ({ prisma: db } = await import("../../lib/prisma"));
  profile = await import("../../app/api/creators/[id]/route");
  const creator = await db.user.create({ data: { username: "Nia Studio", email: "private-creator@example.invalid", bio: "Public biography", walletAddress: wallet } });
  creatorId = creator.id;
  unpublishedId = (await db.user.create({ data: { email: "private-unpublished@example.invalid" } })).id;
  const other = await db.user.create({ data: { username: "Another creator" } });
  await db.item.createMany({ data: records.map((record) => ({ ...record, creatorId, imageUrl: record.id === "creator_work_000" ? "https://example.invalid/approved.png" : null })) });
  await db.item.create({ data: { creatorId: other.id, title: "Other creator's work", itemType: "NFT" } });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
  const image = await db.uploadedImage.create({ data: { ownerUserId: creatorId, ownerWallet: wallet, mimeType: "image/png", data: new Uint8Array(png), byteSize: png.length } });
  privateImageId = image.id;
  const imageUrl = `/api/uploads/${privateImageId}`;
  const factory = "0x2222222222222222222222222222222222222222";
  const importedContract = "0x3333333333333333333333333333333333333333";
  const quarantined = await db.item.create({ data: { creatorId, title: "Quarantined incorrect soulbound import", itemType: "NFT", nftKind: "SOULBOUND", contractAddress: importedContract, deploymentFactory: factory, imageUrl, createdAt: new Date("2026-10-26T00:00:00Z") } });
  quarantinedId = quarantined.id;
  await db.submission.create({ data: { creatorId, creatorName: "Nia Studio", itemType: "NFT", title: quarantined.title, description: "Historical unverified imported contract", imageUrl, priceUsdc: 0, contractAddress: importedContract, status: "APPROVED", itemId: quarantinedId } });
  const importOnlyCreator = await db.user.create({ data: { username: "Only unverified imports" } });
  importOnlyCreatorId = importOnlyCreator.id;
  const onlyImport = await db.item.create({ data: { creatorId: importOnlyCreatorId, title: "Another unverified import", itemType: "NFT", contractAddress: importedContract, deploymentFactory: factory, imageUrl: "https://example.invalid/unverified.png", createdAt: new Date("2026-10-26T00:00:00Z") } });
  await db.submission.create({ data: { creatorId: importOnlyCreatorId, creatorName: "Only unverified imports", itemType: "NFT", title: onlyImport.title, description: "Historical unverified imported contract", imageUrl: onlyImport.imageUrl!, priceUsdc: 0, contractAddress: importedContract, status: "APPROVED", itemId: onlyImport.id } });
  const token = randomBytes(32).toString("hex");
  ownerCookie = `artiq_wallet_session=${token}`;
  await db.walletSession.create({ data: { walletAddress: wallet, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) } });
  await db.watchlistEntry.createMany({ data: [{ userId: creatorId, itemId: quarantinedId }, { userId: creatorId, itemId: "creator_work_000" }] });
});
after(async () => { await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

async function page(query = "", id = creatorId) {
  return profile.GET(new NextRequest(`http://localhost:3000/api/creators/${id}${query}`), { params: Promise.resolve({ id }) });
}

test("creator profiles bound public item responses while preserving aggregate counts and privacy", async () => {
  const response = await page();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.creator.items.length, 48);
  assert.equal(typeof body.nextCursor, "string");
  assert.deepEqual(body.counts, { publishedWorks: 105, nftCollections: 60, artWorks: 45 });
  assert.equal(body.creator.bio, "Public biography");
  assert.ok(body.creator.items.every((item: { creator: { id: string } }) => item.creator.id === creatorId));
  assert.ok(!JSON.stringify(body).includes("private-creator@example.invalid"));
  assert.equal(body.creator.email, undefined);
  assert.equal(body.creator.submissions, undefined);
  assert.equal((await (await page("?limit=100")).json()).creator.items.length, 100);
  assert.equal((await page("", unpublishedId)).status, 404);
  assert.equal((await page("", importOnlyCreatorId)).status, 404, "a quarantined import alone cannot publish a creator profile");
});

test("creator cursor pages reach every published work exactly once with tied timestamps", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: "17", ...(cursor ? { cursor } : {}) });
    const response = await page(`?${query}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.creator.items.length <= 17);
    seen.push(...body.creator.items.map((item: { id: string }) => item.id));
    cursor = body.nextCursor;
  } while (cursor);
  const expected = [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).map((item) => item.id);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 105);
});

test("creator filters search older pages and retain complete profile counts", async () => {
  const search = await (await page("?search=NIA%20quiet&limit=1")).json();
  assert.deepEqual(search.creator.items.map((item: { id: string }) => item.id), ["creator_work_104"]);
  assert.equal(search.nextCursor, null);
  assert.equal(search.counts.publishedWorks, 105);
  const art = await (await page("?itemType=WEB2_ART&limit=100")).json();
  assert.equal(art.creator.items.length, 45);
  assert.ok(art.creator.items.every((item: { itemType: string }) => item.itemType === "WEB2_ART"));
  assert.equal(art.nextCursor, null);
  assert.equal((await (await page("?search=no-matching-work")).json()).creator.items.length, 0);
});

test("creator input rejects unbounded limits, malformed cursors and oversized searches", async () => {
  for (const query of ["?limit=101", "?limit=1000000", "?limit=-1", "?cursor=invalid", "?itemType=ADMIN", `?search=${"a".repeat(201)}`]) {
    assert.equal((await page(query)).status, 400, query);
  }
  assert.equal((await page("", "a".repeat(201))).status, 404);
});

test("catalog cards omit deployment metadata while retaining the same works and launch data", async () => {
  const catalog = await import("../../app/api/items/route");
  await db.item.update({ where: { id: "creator_work_000" }, data: {
    nftKind: "COLLECTIBLE", creationMethod: "AI_ASSISTED", symbol: "NIA", maxSupply: 100, mintedCount: 2,
    maxPerWallet: 3, royaltyBps: 500, metadataUri: "https://example.invalid/metadata.json",
    attributes: Array.from({ length: 20 }, (_, index) => ({ trait_type: `Trait ${index}`, value: "A".repeat(120) })),
  } });
  const url = `http://localhost:3000/api/items?itemType=NFT&creator=${wallet}&limit=100`;
  const fullResponse = await catalog.GET(new NextRequest(url));
  const cardsResponse = await catalog.GET(new NextRequest(`${url}&view=cards`));
  assert.equal(fullResponse.status, 200);
  assert.equal(cardsResponse.status, 200);
  const full = await fullResponse.json();
  const cards = await cardsResponse.json();
  assert.equal(cards.nextCursor, full.nextCursor);
  assert.deepEqual(cards.items.map((item: { id: string }) => item.id), full.items.map((item: { id: string }) => item.id));
  const fullItem = full.items.find((item: { id: string }) => item.id === "creator_work_000");
  const cardItem = cards.items.find((item: { id: string }) => item.id === "creator_work_000");
  assert.equal(fullItem.attributes.length, 20, "existing API consumers keep collection metadata");
  assert.equal(fullItem.symbol, "NIA");
  assert.equal(cardItem.attributes, undefined);
  assert.equal(cardItem.metadataUri, undefined);
  assert.equal(cardItem.symbol, undefined);
  for (const field of ["nftKind", "creationMethod", "maxSupply", "mintedCount", "contractAddress", "status", "mintStartTime", "creator"]) {
    assert.deepEqual(cardItem[field], fullItem[field], `${field} remains available to cards`);
  }
  assert.ok(JSON.stringify(cards).length < JSON.stringify(full).length - 3_000, "card responses avoid transferring unused trait data");
  assert.equal((await catalog.GET(new NextRequest(`${url}&view=unsupported`))).status, 400);
});

test("historical NFT imports stay out of public discovery, watchlists, images and mint-access reads", async () => {
  const [catalog, discovery, trending, watchlist, toggle, image, access] = await Promise.all([
    import("../../app/api/items/route"), import("../../app/api/discovery/route"), import("../../app/api/trending/route"),
    import("../../app/api/watchlist/route"), import("../../app/api/watchlist/[id]/route"),
    import("../../app/api/uploads/[id]/route"), import("../../app/api/items/[id]/mint-access/route"),
  ]);
  const request = (path: string, signed = false, method = "GET") => new NextRequest(`http://localhost:3000${path}`, { method, headers: {
    ...(signed ? { Cookie: ownerCookie, "X-Wallet-Address": wallet } : {}),
    ...(method === "GET" ? {} : { Origin: "http://localhost:3000" }),
  } });
  const listed = await (await catalog.GET(request("/api/items?itemType=NFT&limit=100"))).json();
  assert.equal(listed.items.length, 61);
  assert.ok(!listed.items.some((item: { id: string }) => item.id === quarantinedId));
  const picks = await (await discovery.GET(request("/api/discovery"))).json();
  assert.deepEqual(picks.items.map((item: { id: string }) => item.id), ["creator_work_000"]);
  const drops = await (await trending.GET(request("/api/trending"))).json();
  assert.equal(drops.items.length, 4);
  assert.ok(drops.items.every((item: { title: string }) => !item.title.includes("unverified") && !item.title.includes("Quarantined")));
  const saved = await (await watchlist.GET(request("/api/watchlist", true))).json();
  assert.deepEqual(saved.ids, ["creator_work_000"]);
  assert.equal((await toggle.PUT(request(`/api/watchlist/${quarantinedId}`, true, "PUT"), { params: Promise.resolve({ id: quarantinedId }) })).status, 404);
  assert.equal((await image.GET(request(`/api/uploads/${privateImageId}`), { params: Promise.resolve({ id: privateImageId }) })).status, 404);
  const ownerImage = await image.GET(request(`/api/uploads/${privateImageId}`, true), { params: Promise.resolve({ id: privateImageId }) });
  assert.equal(ownerImage.status, 200);
  assert.equal(ownerImage.headers.get("cache-control"), "private, no-store");
  assert.equal((await access.GET(request(`/api/items/${quarantinedId}/mint-access`), { params: Promise.resolve({ id: quarantinedId }) })).status, 404);
  assert.equal(await db.item.count({ where: { id: quarantinedId } }), 1, "quarantine retains the original item for private review");
  assert.equal(await db.watchlistEntry.count({ where: { itemId: quarantinedId } }), 1, "saved history remains recoverable without public exposure");
});

test("creator UI loads further works and searches the complete paginated catalog", async () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(new URL("../../app/creators/[id]/page.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const requests: URL[] = [];
  const first = { id: "newer", title: "Newer NFT", itemType: "NFT", creator: { username: "Nia" } };
  const older = { id: "older", title: "Older painting", itemType: "WEB2_ART", creator: { username: "Nia" } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    const filtered = url.searchParams.has("itemType") || url.searchParams.has("search");
    return Response.json({
      creator: { id: "nia", username: "Nia", bio: null, avatarUrl: null, walletAddress: null, items: filtered || url.searchParams.has("cursor") ? [older] : [first] },
      counts: { publishedWorks: 2, nftCollections: 1, artWorks: 1 }, nextCursor: filtered || url.searchParams.has("cursor") ? null : "older-page",
    });
  };
  const deps: Record<string, unknown> = {
    "@tanstack/react-query": reactQuery,
    "next/navigation": { useParams: () => ({ id: "nia" }) },
    "next/image": { __esModule: true, default: () => null },
    "@/components/MarketNav": { __esModule: true, default: () => null },
    "@/components/Atmosphere": { __esModule: true, default: () => null },
    "@/components/ShareItemButton": { __esModule: true, default: () => null },
    "@/components/CatalogCard": { __esModule: true, default: ({ item }: { item: { id: string } }) => React.createElement("article", { "data-item-id": item.id }) },
  };
  const output = { exports: {} as { default: React.ComponentType } };
  new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let renderer: ReactTestRenderer | undefined;
  async function until(check: () => boolean) {
    for (let count = 0; count < 60 && !check(); count++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.ok(check(), "creator UI completed its request");
  }
  const shown = () => renderer!.root.findAllByType("article").map((node) => node.props["data-item-id"]);
  try {
    await act(async () => { renderer = create(React.createElement(QueryClientProvider, { client }, React.createElement(output.exports.default))); });
    await until(() => shown().length === 1);
    assert.deepEqual(shown(), ["newer"]);
    const more = renderer!.root.findAllByType("button").find((node) => node.props.children === "Load more works")!;
    assert.ok(more);
    await act(async () => { more.props.onClick(); });
    await until(() => shown().length === 2);
    assert.deepEqual(shown(), ["newer", "older"]);
    assert.ok(requests.some((url) => url.searchParams.get("cursor") === "older-page"));
    await act(async () => { renderer!.root.findByProps({ "aria-label": "Filter creator works" }).props.onChange({ target: { value: "WEB2_ART" } }); });
    await until(() => shown().length === 1);
    assert.deepEqual(shown(), ["older"]);
    await act(async () => { renderer!.root.findByProps({ "aria-label": "Search creator works" }).props.onChange({ target: { value: "older" } }); });
    await until(() => requests.some((url) => url.searchParams.get("search") === "older"));
    const counts = renderer!.root.findAllByType("dd").map((node) => node.props.children);
    assert.deepEqual(counts, [2, 1, 1], "filtering and paging must not shrink profile totals");
  } finally {
    await act(async () => { renderer?.unmount(); });
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
