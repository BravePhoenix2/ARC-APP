import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { PrivySession } from "../../hooks/usePrivySession";

const require = createRequire(import.meta.url);
let session: PrivySession;
let pathname: string;
let loginCalls: number;
let refreshCalls: number;
let destinations: string[];
let renderer: ReactTestRenderer | undefined;
const router = { push: (href: string) => destinations.push(href), refresh: () => { refreshCalls++; } };
const empty = { default: () => null, __esModule: true };
const dependencies: Record<string, unknown> = {
  "next/navigation": { usePathname: () => pathname, useRouter: () => router },
  "next/link": { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true },
  "next/image": empty,
  "@/hooks/usePrivySession": { usePrivySession: () => session },
  "@/components/ArticLogo": empty,
  "@/components/Atmosphere": empty,
  "@/components/DailyMuse": empty,
  "@/components/TrendingDrops": empty,
  "@/components/TestnetNotice": empty,
  "@/components/Eyebrow": empty,
  "@/components/orbit-shapes": { OrbitCircle: () => null, OrbitOval: () => null, OrbitSquare: () => null, OrbitTriangle: () => null },
  "@/lib/arcConfig": { arcChain: { name: "Arc Testnet" } },
};
function compile<T>(path: string): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as T };
  new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
  return output.exports;
}
const entry = compile<{ LaunchAppButton: React.ComponentType; AppAccessGate: React.ComponentType<React.PropsWithChildren> }>("../../components/AppEntry.tsx");
dependencies["@/components/AppEntry"] = entry;
const Home = compile<{ default: React.ComponentType }>("../../app/page.tsx").default;

beforeEach(() => {
  pathname = "/"; loginCalls = 0; refreshCalls = 0; destinations = [];
  session = {
    configured: true, ready: true, authenticated: false, sdkAuthenticated: false,
    profile: null, authenticationState: "signed-out", user: null, error: null,
    login: () => { loginCalls++; }, connectWallet() {}, connectedWallets: [],
    selectWallet: async () => false, logout: async () => true, refresh: async () => false,
    isLoading: false, isSyncing: false, pendingAccounts: [], selectAccount: async () => false,
  };
});
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; });
async function render(element: React.ReactElement) {
  await act(async () => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
function button(label: string) {
  const match = renderer!.root.findAllByType("button").find((node) => node.children.includes(label));
  assert.ok(match, `Missing button: ${label}`);
  return match;
}
function gate(children: React.ReactNode = React.createElement("p", null, "App content")) {
  return React.createElement(entry.AppAccessGate, null, children);
}

test("landing page has one Launch App entry and waits for verified sign-in before navigating", async () => {
  await render(React.createElement(Home));
  assert.equal(renderer!.root.findAllByType("button").length, 1);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Sign in/);
  assert.equal(loginCalls, 0, "viewing the landing page does not open Privy");
  await act(async () => button("Launch App ").props.onClick());
  assert.equal(loginCalls, 1);
  assert.deepEqual(destinations, []);
  await render(React.createElement(Home));
  assert.deepEqual(destinations, [], "closing Privy without signing in keeps the user on the landing page");
  Object.assign(session, { sdkAuthenticated: true, authenticationState: "verifying", isSyncing: true });
  await render(React.createElement(Home));
  assert.deepEqual(destinations, [], "SDK sign-in alone does not grant app entry");
  Object.assign(session, { authenticated: true, authenticationState: "authenticated", isSyncing: false });
  await render(React.createElement(Home));
  assert.deepEqual(destinations, ["/nfts"]);
});

test("verified returning users launch directly without opening Privy", async () => {
  Object.assign(session, { authenticated: true, sdkAuthenticated: true, authenticationState: "authenticated", isSyncing: true });
  await render(React.createElement(entry.LaunchAppButton));
  assert.equal(button("Launch App ").props.disabled, false, "background session refresh does not block a verified user");
  await act(async () => button("Launch App ").props.onClick());
  assert.deepEqual(destinations, ["/nfts"]);
  assert.equal(loginCalls, 0);
});

test("landing remains public while Privy loads", async () => {
  session.ready = false;
  await render(gate());
  assert.match(JSON.stringify(renderer!.toJSON()), /App content/);
  assert.equal(loginCalls, 0);
});

test("direct app links wait for Privy and never mount content before verification", async () => {
  pathname = "/marketplace";
  let mounts = 0;
  function Content() { useEffect(() => { mounts++; }, []); return React.createElement("p", null, "App content"); }
  const content = React.createElement(Content);
  session.ready = false;
  await render(gate(content));
  assert.equal(loginCalls, 0);
  assert.equal(mounts, 0);
  session.ready = true;
  await render(gate(content));
  assert.equal(loginCalls, 1);
  await render(gate(content));
  assert.equal(loginCalls, 1, "cancelling the dialog does not reopen it in a loop");
  assert.equal(mounts, 0);
  Object.assign(session, { sdkAuthenticated: true, authenticationState: "verification-error", error: "Verification failed" });
  await render(gate(content));
  assert.equal(mounts, 0);
  let retries = 0;
  session.refresh = async () => { retries++; return false; };
  await act(async () => button("Retry verification").props.onClick());
  assert.equal(retries, 1);
  Object.assign(session, { authenticated: true, authenticationState: "authenticated", error: null });
  await render(gate(content));
  assert.equal(mounts, 1);
  assert.equal(refreshCalls, 1, "server permission checks reload with the verified session cookie");
  assert.match(JSON.stringify(renderer!.toJSON()), /App content/);
  await render(gate(content));
  assert.equal(refreshCalls, 1, "verified rerenders do not refresh the route repeatedly");
  Object.assign(session, { authenticated: false, authenticationState: "signing-out" });
  await render(gate(content));
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /App content/);
});

test("account selection completes launch without bypassing verification", async () => {
  Object.assign(session, { sdkAuthenticated: true, authenticationState: "verification-error", pendingAccounts: [{ id: "existing", label: "Existing account" }] });
  let selected: string | undefined;
  session.selectAccount = async (id) => { selected = id; return true; };
  await render(React.createElement(entry.LaunchAppButton));
  await act(async () => button("Launch App ").props.onClick());
  assert.equal(loginCalls, 0);
  await act(async () => button("Existing account").props.onClick());
  assert.equal(selected, "existing");
  assert.deepEqual(destinations, []);
  Object.assign(session, { authenticated: true, authenticationState: "authenticated", pendingAccounts: [] });
  await render(React.createElement(entry.LaunchAppButton));
  assert.deepEqual(destinations, ["/nfts"]);
});

test("missing Privy configuration keeps app pages locked and shows the setup message", async () => {
  pathname = "/nfts"; session.configured = false;
  session.login = () => { session.error = "Sign-in is being set up. Please try again soon."; };
  await render(gate());
  await act(async () => button("Sign in to continue").props.onClick());
  await render(gate());
  assert.match(JSON.stringify(renderer!.toJSON()), /Sign-in is being set up/);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /App content/);
});
