import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React, { useContext, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ts from "typescript";
import type { PrivySession } from "../../hooks/usePrivySession";

// Execute the real provider with deterministic SDK, HTTP and clock boundaries.
// No login, email, database, or provider network requests leave this process.
const require = createRequire(import.meta.url);
const context = React.createContext<PrivySession>(null as unknown as PrivySession);
const queryClient = { cancelQueries() {}, removeQueries() {} };
let sdk: { ready: boolean; authenticated: boolean; user: { id: string; email: { address: string }; linkedAccounts: Array<Record<string, string>> } };
let session: PrivySession;
let renderer: ReactTestRenderer | undefined;
let events: EventTarget;
let responses: Array<Response | Error>;
let timers: Array<{ callback: () => void; delay: number; active: boolean }>;
let draftUnmounts: number;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const dependencies: Record<string, unknown> = {
  "@privy-io/react-auth": {
    usePrivy: () => ({ ...sdk, getAccessToken: async () => "signed-access", login() {}, logout: async () => {} }),
    useUser: () => ({ refreshUser: async () => {} }),
    useIdentityToken: () => ({ identityToken: "signed-identity" }),
    getIdentityToken: async () => "signed-identity",
    useLinkAccount: () => ({ linkWallet() {} }),
    useWallets: () => ({ wallets: [] }),
  },
  "@privy-io/wagmi": { useSetActiveWallet: () => ({ setActiveWallet: async () => {} }) },
  "@tanstack/react-query": { useQueryClient: () => queryClient },
  wagmi: { useAccount: () => ({}), useDisconnect: () => ({ disconnectAsync: async () => {} }) },
  "@/hooks/usePrivySession": { PrivySessionContext: context },
  "@/lib/privyClient": { PRIVY_SESSION_CHANGED: "session-changed", PRIVY_SETUP_MESSAGE: "Setup required" },
};
const source = readFileSync(new URL("../../components/PrivyAuthProvider.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
const output = { exports: {} as { default: React.ComponentType<React.PropsWithChildren> } };
new Function("require", "module", "exports", compiled.outputText)((name: string) => dependencies[name] ?? require(name), output, output.exports);
const Provider = output.exports.default;

function Draft() {
  useEffect(() => () => { draftUnmounts++; }, []);
  return React.createElement("textarea", { defaultValue: "Review in progress" });
}
function Probe() {
  session = useContext(context);
  return session.authenticated ? React.createElement(Draft) : null;
}
function success(id = "reviewer", expiresAt = Date.now() + 3_600_000) {
  return Response.json({ user: { id, email: "reviewer@example.com", walletAddress: null, walletAddresses: [], authMethod: "PRIVY", isAdmin: true }, expiresAt: new Date(expiresAt).toISOString() });
}
async function render() {
  await act(async () => {
    const tree = React.createElement(Provider, null, React.createElement(Probe));
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
async function focus() { await act(async () => { events.dispatchEvent(new Event("focus")); }); }
async function refresh() { await act(async () => { await session.refresh(); }); }

beforeEach(() => {
  sdk = { ready: true, authenticated: true, user: { id: "did:privy:reviewer", email: { address: "reviewer@example.com" }, linkedAccounts: [{ type: "email", address: "reviewer@example.com" }] } };
  events = new EventTarget(); responses = []; timers = []; draftUnmounts = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    setInterval: () => 1, clearInterval() {},
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay, active: true }); return timers.length; },
    clearTimeout: (id: number) => { if (timers[id - 1]) timers[id - 1].active = false; },
  } });
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "DELETE") return Response.json({ ok: true });
    const response = responses.shift();
    assert.ok(response, "Unexpected session request");
    if (response instanceof Error) throw response;
    return response;
  };
});
afterEach(async () => {
  await act(async () => renderer?.unmount()); renderer = undefined;
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("provider/network refresh failures keep a valid reviewer session and mounted review notes", async () => {
  responses.push(success()); await render();
  assert.equal(session.authenticated, true);
  responses.push(Response.json({ error: "Verification unavailable" }, { status: 503 })); await refresh();
  assert.equal(session.authenticated, true);
  assert.equal(session.authenticationState, "authenticated");
  assert.equal(session.error, "Verification unavailable");
  responses.push(new TypeError("fetch failed")); await refresh();
  assert.equal(session.authenticated, true);
  assert.equal(draftUnmounts, 0);
  responses.push(success()); await refresh();
  assert.equal(session.error, null);
});

test("an embedded wallet appearing refreshes proofs without resetting the reviewer", async () => {
  responses.push(success()); await render();
  responses.push(Response.json({ error: "Temporary outage" }, { status: 503 }));
  sdk = { ...sdk, user: { ...sdk.user, linkedAccounts: [...sdk.user.linkedAccounts, { type: "wallet", chainType: "ethereum", address: `0x${"1".repeat(40)}` }] } };
  await render();
  assert.equal(session.authenticated, true);
  assert.equal(draftUnmounts, 0);
  assert.equal(responses.length, 0);
});

test("rejected credentials and switching Privy identities clear the previous reviewer", async () => {
  responses.push(success()); await render();
  responses.push(Response.json({ error: "Invalid token" }, { status: 401 })); await refresh();
  assert.equal(session.authenticated, false);
  responses.push(success()); await focus();
  sdk = { ...sdk, user: { ...sdk.user, id: "did:privy:other" } };
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 })); await render();
  assert.equal(session.authenticated, false);
  assert.equal(session.user, null);
});

test("renewal runs before expiry, but hard expiry still locks a failed session", async () => {
  responses.push(success()); await render();
  const active = timers.filter((timer) => timer.active).sort((a, b) => a.delay - b.delay);
  assert.equal(active.length, 2);
  assert.ok(active[1].delay - active[0].delay >= 59_000);
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 }));
  await act(async () => { active[0].callback(); });
  assert.equal(session.authenticated, true);
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 }));
  await act(async () => { active[1].callback(); });
  assert.equal(session.authenticated, false);
});

test("tab focus does not repeat provider verification for an unexpired session", async () => {
  responses.push(success()); await render();
  const untouched = success();
  responses.push(untouched);
  await focus(); await focus(); await focus();
  assert.equal(responses[0], untouched);
  assert.equal(session.error, null);
  assert.equal(session.authenticated, true);
});
