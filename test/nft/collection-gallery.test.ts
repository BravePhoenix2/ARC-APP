import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { GalleryImage } from "../../components/CollectionImageGallery";

test("collection galleries search token numbers and filenames and sort without changing token assignments", async () => {
  const require = createRequire(import.meta.url);
  const code = ts.transpileModule(readFileSync(new URL("../../components/CollectionImageGallery.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as { default: React.ComponentType<{ images: GalleryImage[] }> } };
  new Function("require", "module", "exports", code)((name: string) => name === "next/image" ? { __esModule: true, default: () => null } : require(name), output, output.exports);
  const images = [1, 2, 3].map((position) => ({ position, filename: position === 2 ? "Sunset.png" : `Study-${position}.png`, imageUrl: `/image/${position}` }));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(output.exports.default, { images })); });
  try {
    const links = () => renderer.root.findAllByType("a").map((node) => node.props.href);
    act(() => renderer.root.findByProps({ "aria-label": "Search collection images" }).props.onChange({ target: { value: "#2" } }));
    assert.deepEqual(links(), ["/image/2"]);
    act(() => renderer.root.findByProps({ "aria-label": "Search collection images" }).props.onChange({ target: { value: "sunset" } }));
    assert.deepEqual(links(), ["/image/2"]);
    act(() => renderer.root.findByProps({ "aria-label": "Search collection images" }).props.onChange({ target: { value: "" } }));
    act(() => renderer.root.findByProps({ "aria-label": "Sort collection images" }).props.onChange({ target: { value: "reverse" } }));
    assert.deepEqual(links(), ["/image/3", "/image/2", "/image/1"]);
    assert.deepEqual(images.map((image) => image.position), [1, 2, 3]);
  } finally { await act(async () => renderer.unmount()); }
});
