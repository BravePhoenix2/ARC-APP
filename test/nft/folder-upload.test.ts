import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { CollectionImageInput } from "../../lib/collectionImages";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../../components/CollectionFolderUpload.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const output = { exports: {} as { default: React.ComponentType<React.ComponentProps<typeof Harness>> } };
const dependencies: Record<string, unknown> = {
  "next/image": { __esModule: true, default: () => null },
  "@/lib/collectionImages": require("../../lib/collectionImages"),
};
new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
const FolderUpload = output.exports.default as React.ComponentType<Record<string, unknown>>;
let renderer: ReactTestRenderer | undefined;
let images: CollectionImageInput[];
let attempts: number;
let failAt: number;
const originalFetch = globalThis.fetch;
function Harness() {
  const [current, setCurrent] = useState<CollectionImageInput[]>([]);
  const [busy, setBusy] = useState(false);
  images = current;
  return React.createElement(FolderUpload, { images: current, onChange: setCurrent, headers: { "X-Artiq-Account-ID": "creator" }, busy, onBusy: setBusy });
}
const image = (name: string) => new File(["test-image"], name, { type: "image/png" });
async function select(files: File[]) {
  await act(async () => {
    renderer!.root.findByProps({ "aria-label": "Choose collection folder" }).props.onChange({ target: { files } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(async () => {
  images = []; attempts = 0; failAt = 0;
  globalThis.fetch = async (_url, options) => {
    attempts++;
    assert.equal((options?.headers as Record<string, string>)["X-Artiq-Account-ID"], "creator");
    assert.equal((options?.body as FormData).get("itemType"), "NFT");
    return attempts === failAt ? Response.json({ error: "Temporary failure" }, { status: 503 }) : Response.json({ url: `/api/uploads/${String(attempts).padStart(24, "0")}` }, { status: 201 });
  };
  await act(async () => { renderer = create(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; globalThis.fetch = originalFetch; });

test("folder uploads sort numbered images, skip non-images and allow reordering/removal", async () => {
  await select([image("10.png"), new File(["notes"], "readme.txt"), image("2.png"), image("1.png")]);
  assert.deepEqual(images.map((entry) => entry.filename), ["1.png", "2.png", "10.png"]);
  assert.equal(attempts, 3);
  await act(async () => renderer!.root.findByProps({ "aria-label": "Move 2.png earlier" }).props.onClick());
  assert.deepEqual(images.map((entry) => entry.filename), ["2.png", "1.png", "10.png"]);
  await act(async () => renderer!.root.findAllByType("button").find((node) => node.props.children === "Remove")!.props.onClick());
  assert.deepEqual(images.map((entry) => entry.filename), ["1.png", "10.png"]);
});

test("retrying the same folder retains completed uploads and sends only the remaining images", async () => {
  failAt = 2; const files = [image("1.png"), image("2.png"), image("3.png")];
  await select(files); assert.equal(images.length, 1);
  assert.ok(renderer!.root.findByProps({ role: "alert" }));
  failAt = 0; await select(files);
  assert.equal(attempts, 4); assert.deepEqual(images.map((entry) => entry.filename), ["1.png", "2.png", "3.png"]);
});

test("oversized collections and duplicate filenames are rejected before sending files", async () => {
  await select(Array.from({ length: 101 }, (_, index) => image(`${index}.png`)));
  assert.equal(attempts, 0); assert.equal(images.length, 0);
  await select([image("same.png"), image("same.png")]);
  assert.equal(attempts, 0);
});
