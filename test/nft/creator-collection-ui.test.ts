import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from "react-test-renderer";
import ts from "typescript";

// Render the real form with deterministic account, router, and HTTP boundaries.
// No wallet payment, provider login, detector request, or real upload is made.
const require = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWOwr9jyHwAE0AJrq3udBQAAAABJRU5ErkJggg==", "base64");
let renderer: ReactTestRenderer | undefined;
let destinations: string[];
let submitted: Record<string, unknown>[];
let responseStatus: "APPROVED" | "PENDING";
let includeItemId: boolean;
let walletRequests: number;
let history: Array<Record<string, unknown>>;
const noop = () => null;
const dependencies: Record<string, unknown> = {
  "next/navigation": { useRouter: () => ({ push: (destination: string) => destinations.push(destination) }) },
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: noop, __esModule: true },
  "@/components/Atmosphere": { default: noop, __esModule: true },
  "@/components/ArticLogo": { default: noop, __esModule: true },
  "@/components/ConnectWalletButton": { default: noop, __esModule: true },
  "@/components/CollectionFolderUpload": { default: noop, __esModule: true },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => ({
    user: { id: "creator-account", email: "creator@example.com" }, isLoading: false, error: null,
    refresh: async () => true, logout: async () => true, connectWallet: () => { walletRequests++; },
  }) },
  "@/lib/nftTypes": require("../../lib/nftTypes"),
  "@tanstack/react-query": {
    useQueryClient: () => ({ invalidateQueries: async () => {} }),
    useQuery: () => ({ data: history, isLoading: false, isError: false, isFetching: false, refetch: async () => {} }),
  },
};
const source = readFileSync(new URL("../../components/CreatorApplication.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType<{ initialItemType: "NFT" | "WEB2_ART" }> } };
new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
const CreatorApplication = output.exports.default;

beforeEach(() => {
  destinations = []; submitted = []; history = []; walletRequests = 0;
  responseStatus = "APPROVED"; includeItemId = true;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "/api/uploads") return Response.json({ url: "/api/uploads/owned-image", screening: { status: "REVIEW_REQUIRED", summary: "The reviewer will inspect your creation details.", signals: [] } });
    assert.equal(String(url), "/api/submissions");
    assert.equal(options?.method, "POST");
    const body = JSON.parse(String(options?.body));
    submitted.push(body);
    return Response.json({ submission: { id: "saved-details", title: body.title, itemType: body.itemType, status: responseStatus, ...(includeItemId ? { itemId: "new-collection" } : {}), createdAt: "2026-11-09T12:00:00Z" } }, { status: 201 });
  };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; globalThis.fetch = originalFetch; });

async function render(initialItemType: "NFT" | "WEB2_ART" = "NFT") {
  await act(async () => { renderer = create(React.createElement(CreatorApplication, { initialItemType })); });
}
function visibleText(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null = renderer!.toJSON()): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(visibleText).join(" ");
  return node?.children?.map(visibleText).join(" ") || "";
}
async function fill(id: string, value: string) {
  await act(async () => { renderer!.root.findByProps({ id }).props.onChange({ target: { value } }); });
}
async function fillDetails() {
  await fill("creator-name", "Creator"); await fill("art-title", "New collection");
  await fill("art-description", "Original work with a complete creation story."); await fill("art-price", "1");
}
async function nftImage() {
  const imageUrl = renderer!.root.findAllByType("button").find((node) => node.children.includes("Image URL"))!;
  await act(async () => imageUrl.props.onClick());
  await fill("image-url", "https://images.example.com/collection.png");
}
async function submit() {
  await act(async () => { await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
}

test("NFT details go straight to collection setup and disclose the later 5 test USDC wallet fee", async () => {
  await render();
  assert.match(visibleText(), /without reviewer approval/);
  assert.match(visibleText(), /one-time 5 test USDC creation fee directly to the platform wallet/);
  assert.match(visibleText(), /Continue to collection setup/);
  assert.doesNotMatch(visibleText(), /Submit for review/);
  await fillDetails(); await nftImage(); await submit();
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].itemType, "NFT");
  assert.equal(submitted[0].priceUsdc, "1", "the collector mint price is independent of the creation fee");
  assert.deepEqual(destinations, ["/nfts/new-collection"]);
  assert.equal(walletRequests, 0, "saving collection details does not initiate a wallet payment");
  assert.match(visibleText(), /Your collection setup is ready/);
  assert.doesNotMatch(visibleText(), /was submitted for review/);
});

test("a missing NFT setup link keeps the user on the form with a recovery message", async () => {
  includeItemId = false;
  await render(); await fillDetails(); await nftImage(); await submit();
  assert.deepEqual(destinations, []);
  assert.equal(walletRequests, 0);
  assert.match(visibleText(), /collection setup link is not ready/);
  assert.equal(renderer!.root.findByProps({ id: "art-title" }).props.value, "New collection");
});

test("NFT history shows Ready and opens the collection rather than claiming reviewer approval", async () => {
  history = [{ id: "existing-details", title: "Existing collection", itemType: "NFT", nftKind: "COLLECTIBLE", status: "APPROVED", itemId: "existing-collection", createdAt: "2026-11-09T12:00:00Z" }];
  await render();
  const article = renderer!.root.findByType("article");
  const status = article.findAllByType("span").find((node) => node.children.includes("Ready"));
  assert.ok(status);
  assert.ok(article.findAllByType("a").some((node) => node.props.href === "/nfts/existing-collection"));
});

test("historical NFT applications explain the new flow while original art stays pending review", async () => {
  history = [
    { id: "old-nft", title: "Previous NFT", itemType: "NFT", status: "PENDING", createdAt: "2026-11-09T12:00:00Z" },
    { id: "pending-art", title: "Art application", itemType: "WEB2_ART", status: "PENDING", createdAt: "2026-11-09T12:00:00Z" },
  ];
  await render();
  const articles = renderer!.root.findAllByType("article");
  assert.ok(articles[0].findAllByType("span").some((node) => node.children.includes("Previous NFT application")));
  assert.ok(articles[0].findAllByType("p").some((node) => node.children.includes("NFTs no longer need approval. Save a new collection setup to continue.")));
  assert.ok(articles[1].findAllByType("span").some((node) => node.children.includes("Pending review")));
  assert.deepEqual(destinations, [], "historical private artwork is never published implicitly");
});

test("ART BAZZAR keeps human review and does not use the NFT creation fee or redirect", async () => {
  responseStatus = "PENDING"; includeItemId = false;
  await render("WEB2_ART"); await fillDetails();
  assert.match(visibleText(), /Submit for review/);
  assert.doesNotMatch(visibleText(), /one-time 5 test USDC creation fee/);
  await fill("creation-process", "I drew the original artwork by hand with ink and paper.");
  await act(async () => renderer!.root.findByProps({ id: "human-made-declaration" }).props.onChange({ target: { checked: true } }));
  await act(async () => { await renderer!.root.findByProps({ id: "art-image" }).props.onChange({ target: { files: [new File([png], "painting.png", { type: "image/png" })] } }); });
  await submit();
  assert.equal(submitted.length, 1); assert.equal(submitted[0].itemType, "WEB2_ART");
  assert.equal(submitted[0].humanMadeDeclaration, true);
  assert.deepEqual(destinations, []);
  assert.equal(walletRequests, 0);
  assert.match(visibleText(), /was submitted for review/);
});
