import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as reactQuery from "@tanstack/react-query";
import ts from "typescript";
import { PrivySessionContext, unconfiguredSession, usePrivySession, type PrivySession } from "../../hooks/usePrivySession";

const require = createRequire(import.meta.url);
let pathname: string;
let loads: number;
let failLoad: boolean;
let renderer: ReactTestRenderer | undefined;
let observed: PrivySession;
let runtimeSession: PrivySession;
let clients: QueryClient[];
const dependencies: Record<string, unknown> = {
  // The transpiled component must share the ESM context used by the probes.
  "@tanstack/react-query": reactQuery,
  "next/navigation": { usePathname: () => pathname, useRouter: () => ({ push() {}, refresh() {} }) },
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "@/components/ArticLogo": { default: () => null, __esModule: true },
  "@/hooks/usePrivySession": { PrivySessionContext, unconfiguredSession, usePrivySession },
  "@/lib/privyClient": { privyAppId: "test-app" },
};
function compile<T>(path: string): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as T };
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "./wallet-providers") {
      loads++;
      if (failLoad) throw new Error("Chunk unavailable");
      return { default: Runtime, __esModule: true };
    }
    return dependencies[name] ?? require(name);
  }, output, output.exports);
  return output.exports;
}
const entry = compile<{ AppAccessGate: React.ComponentType<React.PropsWithChildren> }>("../../components/AppEntry.tsx");
dependencies["@/components/AppEntry"] = entry;
const Providers = compile<{ default: React.ComponentType<React.PropsWithChildren> }>("../../app/providers.tsx").default;

function Runtime({ children }: React.PropsWithChildren) {
  return React.createElement(PrivySessionContext.Provider, { value: runtimeSession }, React.createElement(entry.AppAccessGate, null, children));
}
function Probe() {
  observed = usePrivySession();
  clients.push(useQueryClient());
  return React.createElement("p", null, "Page content");
}
async function render() {
  await act(async () => {
    const element = React.createElement(Providers, null, React.createElement(Probe));
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
beforeEach(() => {
  pathname = "/"; loads = 0; failLoad = false; clients = [];
  runtimeSession = { ...unconfiguredSession, configured: true };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });

test("server renders the landing page without importing the wallet SDK", () => {
  const html = renderToStaticMarkup(React.createElement(Providers, null, React.createElement(Probe)));
  assert.match(html, /Page content/);
  assert.equal(loads, 0);
  assert.equal(observed.ready, false);
  assert.equal(observed.authenticated, false);
});

test("wallet initialization keeps the public query cache and reports readiness", async () => {
  await render();
  assert.equal(loads, 1);
  assert.equal(observed.ready, true);
  assert.equal(observed.authenticated, false);
  assert.ok(clients.length >= 2);
  assert.ok(clients.every((client) => client === clients[0]), "loading the wallet runtime preserves cached public queries");
});

test("a failed wallet chunk can be retried without reloading the page", async () => {
  failLoad = true;
  await render();
  assert.equal(observed.authenticated, false);
  assert.match(observed.error!, /Sign-in could not load/);
  assert.equal(observed.ready, true, "the sign-in button remains available for retry");
  failLoad = false;
  await act(async () => observed.login());
  assert.equal(loads, 2);
  assert.equal(observed.ready, true);
  assert.equal(observed.error, null);
});

test("deferred wallet loading never grants access to a direct app link", async () => {
  pathname = "/nfts";
  const html = renderToStaticMarkup(React.createElement(Providers, null, React.createElement(Probe)));
  assert.doesNotMatch(html, /Page content/);
  assert.match(html, /Sign in to enter Artiq/);
  assert.equal(loads, 0);
  await render();
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Page content/);
  runtimeSession = { ...runtimeSession, sdkAuthenticated: true, authenticationState: "verifying" };
  await render();
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Page content/);
  runtimeSession = { ...runtimeSession, authenticated: true, authenticationState: "authenticated" };
  await render();
  assert.match(JSON.stringify(renderer!.toJSON()), /Page content/);
});
