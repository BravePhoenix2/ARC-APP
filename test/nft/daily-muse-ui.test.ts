import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { DailyMuseData } from "../../lib/dailyMuse";
const require = createRequire(import.meta.url);
const storageKey = "artiq:daily-muse:notebook:v1";
const descriptors = ["window", "localStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let renderer: ReactTestRenderer | undefined;
let stored: Map<string, string>;
let storageFailure: boolean;
const data: DailyMuseData = { day: "2026-10-21", nextAt: "2026-10-21T23:00:00.000Z", theme: "Look closer", prompt: "Find one detail.", items: [{ id: "nft-one", itemType: "NFT", title: "Blue horizon", imageUrl: "/api/uploads/test-image", creator: { id: "creator", username: "Artist", walletAddress: null } }, { id: "art-one", itemType: "WEB2_ART", title: "Sunlit room", imageUrl: "/api/uploads/other-image", creator: { id: "creator", username: "Artist", walletAddress: null } }] };
const refetch = async () => {};
const deps: Record<string, unknown> = {
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": { default: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }), __esModule: true },
  "@tanstack/react-query": { useQuery: () => ({ data, refetch, isLoading: false, isError: false }) },
  "@/components/CreatorLink": { default: () => null, __esModule: true },
  "@/components/WatchlistButton": { default: ({ itemId }: { itemId: string }) => React.createElement("button", { "data-save-item": itemId }, "Watchlist"), __esModule: true },
  "@/components/ShareItemButton": { default: () => null, __esModule: true },
  "@/lib/dailyMuse": require("../../lib/dailyMuse"),
};
const source = readFileSync(new URL("../../components/DailyMuse.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType<{ mode?: string }> } };
new Function("require", "module", "exports", code)((name: string) => deps[name] ?? require(name), output, output.exports);
const DailyMuse = output.exports.default;
async function mount(mode = "NFT") { await act(async () => { renderer = create(React.createElement(DailyMuse, { mode })); }); }
async function reveal() { const button = renderer!.root.findAllByType("button").find((node) => node.props["aria-expanded"] === false)!; assert.ok(button); await act(async () => button.props.onClick()); }
beforeEach(() => {
  stored = new Map(); storageFailure = false; data.day = "2026-10-21";
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setTimeout: () => 1, clearTimeout: () => {} } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => { if (storageFailure) throw Error("Unavailable"); return stored.get(key) ?? null; }, setItem: (key: string, value: string) => { if (storageFailure) throw Error("Unavailable"); stored.set(key, value); } } });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } });
test("revealing a muse opens the correct work and stamps a single local notebook page", async () => {
  await mount(); assert.equal(renderer!.root.findAllByType("img").length, 0);
  await reveal();
  assert.equal(renderer!.root.findByType("img").props.alt, "Blue horizon");
  assert.ok(renderer!.root.findAllByType("a").some((node) => node.props.href === "/nfts/nft-one"));
  assert.equal(renderer!.root.findByProps({ "data-save-item": "nft-one" }).props.children, "Watchlist");
  assert.deepEqual(JSON.parse(stored.get(storageKey)!), [{ day: "2026-10-21", items: ["nft-one"] }]);
  await act(async () => renderer!.unmount()); await mount();
  assert.equal(renderer!.root.findAllByType("img").length, 1); assert.equal(JSON.parse(stored.get(storageKey)!).length, 1);
});
test("ART BAZZAR and NFT reveals share one discovery day; the next day opens a fresh reveal", async () => {
  await mount(); await reveal(); await act(async () => renderer!.unmount()); await mount("WEB2_ART"); await reveal();
  assert.equal(renderer!.root.findByType("img").props.alt, "Sunlit room");
  assert.deepEqual(JSON.parse(stored.get(storageKey)!), [{ day: "2026-10-21", items: ["nft-one", "art-one"] }]);
  data.day = "2026-10-25";
  await act(async () => renderer!.update(React.createElement(DailyMuse, { mode: "WEB2_ART" })));
  assert.equal(renderer!.root.findAllByType("img").length, 0); await reveal();
  const pages = JSON.parse(stored.get(storageKey)!); assert.equal(pages.length, 2); assert.equal(pages[0].day, "2026-10-21");
});
test("blocked browser storage does not prevent revealing the work", async () => {
  storageFailure = true; await mount(); await reveal();
  assert.equal(renderer!.root.findByType("img").props.alt, "Blue horizon");
  assert.match(JSON.stringify(renderer!.toJSON()), /storage is unavailable/);
});
