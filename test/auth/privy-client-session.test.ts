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
let responses: Array<Response | Error | Promise<Response>>;
let timers: Array<{ callback: () => void; delay: number; active: boolean }>;
let draftUnmounts: number;
let accessToken: () => Promise<string | null>;
let identityToken: () => Promise<string | null>;
let observedIdentityToken: string | null;
let postCount: number;
let postedBodies: Array<{ accessToken: string; identityToken: string | null; forceProfileRefresh?: boolean }>;
let sdkLogout: () => Promise<void>;
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const dependencies: Record<string, unknown> = {
  "@privy-io/react-auth": {
    usePrivy: () => ({ ...sdk, getAccessToken: () => accessToken(), login() {}, logout: () => sdkLogout() }),
    useUser: () => ({ refreshUser: async () => {} }),
    useIdentityToken: () => ({ identityToken: observedIdentityToken }),
    getIdentityToken: () => identityToken(),
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
  accessToken = async () => "signed-access";
  identityToken = async () => "signed-identity";
  observedIdentityToken = "signed-identity";
  sdkLogout = async () => {};
  postCount = 0;
  postedBodies = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
    setInterval: () => 1, clearInterval() {},
    setTimeout: (callback: () => void, delay: number) => { timers.push({ callback, delay, active: true }); return timers.length; },
    clearTimeout: (id: number) => { if (timers[id - 1]) timers[id - 1].active = false; },
  } });
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "DELETE") return Response.json({ ok: true });
    postCount++;
    postedBodies.push(JSON.parse(String(options?.body)));
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
  assert.equal(postedBodies[0].forceProfileRefresh, undefined);
  responses.push(Response.json({ error: "Temporary outage" }, { status: 503 }));
  sdk = { ...sdk, user: { ...sdk.user, linkedAccounts: [...sdk.user.linkedAccounts, { type: "wallet", chainType: "ethereum", address: `0x${"1".repeat(40)}` }] } };
  await render();
  assert.equal(session.authenticated, true);
  assert.equal(draftUnmounts, 0);
  assert.equal(responses.length, 0);
  assert.equal(postedBodies[1].forceProfileRefresh, true, "linked-account changes request a fresh ownership snapshot");
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


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fireTimer(timer: { callback: () => void; active: boolean }) {
  timer.active = false;
  await act(async () => { timer.callback(); });
}
function retryTimer() { return timers.find((timer) => timer.active && timer.delay >= 2_000 && timer.delay < 5_000); }

test("access and identity token reads run concurrently before server verification", async () => {
  const access = deferred<string>();
  const identity = deferred<string>();
  let identityReads = 0;
  accessToken = () => access.promise;
  identityToken = () => { identityReads++; return identity.promise; };
  responses.push(success());
  await render();
  assert.equal(identityReads, 1, "identity retrieval starts while the access token is pending");
  assert.equal(postCount, 0);
  await act(async () => { identity.resolve("concurrent-identity"); });
  assert.equal(postCount, 0, "server verification waits for the access token");
  await act(async () => { access.resolve("concurrent-access"); });
  assert.equal(postCount, 1);
  assert.equal(postedBodies[0].accessToken, "concurrent-access");
  assert.equal(postedBodies[0].identityToken, "concurrent-identity");
  assert.equal(session.authenticated, true);
});

test("a missing access token fails immediately even if the identity token read stalls", async () => {
  accessToken = async () => null;
  identityToken = () => new Promise(() => {});
  await render();
  assert.equal(postCount, 0);
  assert.equal(session.isSyncing, false);
  assert.equal(session.authenticated, false);
  assert.match(session.error!, /sign-in has expired/);
  assert.equal(timers.some((timer) => timer.active), false);
});

test("a stalled SDK token read times out, releases loading and ignores late credentials", async () => {
  const token = deferred<string>();
  accessToken = () => token.promise;
  await render();
  assert.equal(session.isSyncing, true);
  const deadline = timers.find((timer) => timer.active && timer.delay === 20_000)!;
  await fireTimer(deadline);
  assert.equal(session.isSyncing, false);
  assert.equal(session.authenticationState, "verification-error");
  assert.match(session.error!, /took too long/);
  await act(async () => { token.resolve("late-token"); });
  assert.equal(postCount, 0);
  accessToken = async () => "fresh-token";
  responses.push(success());
  await refresh();
  assert.equal(session.authenticated, true);
});

test("concurrent refreshes share one verification request", async () => {
  responses.push(success()); await render();
  const token = deferred<string>(); accessToken = () => token.promise;
  let first!: Promise<boolean>; let second!: Promise<boolean>;
  await act(async () => { first = session.refresh(); second = session.refresh(); });
  responses.push(success());
  await act(async () => { token.resolve("fresh-token"); assert.deepEqual(await Promise.all([first, second]), [true, true]); });
  assert.equal(postCount, 2, "one bootstrap and one shared refresh");
  assert.equal(postedBodies[0].forceProfileRefresh, undefined);
  assert.equal(postedBodies[1].forceProfileRefresh, true, "an explicit refresh bypasses the brief server profile cache");
});

test("temporary login failures retry twice with backoff, then stop", async () => {
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 })); await render();
  const first = retryTimer()!; assert.ok(first);
  responses.push(new TypeError("fetch failed")); await fireTimer(first);
  const second = retryTimer()!; assert.ok(second);
  assert.ok(second.delay > first.delay);
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 })); await fireTimer(second);
  assert.equal(retryTimer(), undefined);
  assert.equal(postCount, 3);
  assert.equal(session.isSyncing, false);
  responses.push(success()); await refresh();
  assert.equal(session.authenticated, true);
});

test("rejected credentials do not schedule automatic retries", async () => {
  responses.push(Response.json({ error: "Invalid token" }, { status: 401 })); await render();
  assert.equal(retryTimer(), undefined);
  assert.equal(session.authenticated, false);
  assert.equal(postCount, 1);
});

test("a missing identity token uses the server fallback immediately", async () => {
  let reads = 0;
  observedIdentityToken = null;
  identityToken = async () => { reads++; return null; };
  responses.push(success()); await render();
  assert.equal(reads, 1);
  assert.equal(postCount, 1);
  assert.equal(session.authenticated, true);
});

for (const getterFailure of ["missing", "error"] as const) {
  test(`an initially observed identity proof is submitted when the identity getter returns ${getterFailure}`, async () => {
    observedIdentityToken = "hook-signed-identity";
    identityToken = async () => {
      if (getterFailure === "error") throw new Error("Identity token storage is temporarily unavailable");
      return null;
    };
    responses.push(success());
    await render();
    assert.equal(postCount, 1);
    assert.equal(postedBodies[0].identityToken, "hook-signed-identity", "the server receives signed claims instead of needing a profile lookup");
    assert.equal(session.authenticated, true);
    assert.equal(session.error, null);
  });
}

test("a stalled HTTP verification times out without discarding a valid session", async () => {
  responses.push(success()); await render();
  const response = deferred<Response>();
  globalThis.fetch = () => response.promise;
  let result!: Promise<boolean>;
  await act(async () => { result = session.refresh(); });
  await fireTimer(timers.find((timer) => timer.active && timer.delay === 20_000)!);
  assert.equal(await result, false);
  assert.equal(session.isSyncing, false);
  assert.equal(session.authenticated, true);
  assert.equal(draftUnmounts, 0);
  await act(async () => { response.resolve(success("wrong-late-account")); });
  assert.equal(session.user?.id, "reviewer");
});

test("a stalled SDK logout releases the button and keeps private UI locked", async () => {
  responses.push(success()); await render();
  sdkLogout = () => new Promise(() => {});
  let result!: Promise<boolean>;
  await act(async () => { result = session.logout(); });
  await fireTimer(timers.find((timer) => timer.active && timer.delay === 30_000)!);
  assert.equal(await result, false);
  assert.equal(session.authenticationState, "signed-out");
  assert.equal(session.authenticated, false);
  assert.equal(session.isLoading, false);
  assert.match(session.error!, /Sign-out took too long/);
});

test("renewal with an unchanged token expiry does not start a refresh loop", async () => {
  const expiresAt = Date.now() + 3_600_000;
  responses.push(success("reviewer", expiresAt)); await render();
  const renewal = timers.filter((timer) => timer.active).sort((a, b) => a.delay - b.delay)[0];
  responses.push(success("reviewer", expiresAt)); await fireTimer(renewal);
  const active = timers.filter((timer) => timer.active);
  assert.equal(active.length, 1, "only hard expiry remains scheduled");
  assert.ok(active[0].delay > 3_500_000);
  assert.equal(postCount, 2);
});

test("failed verification cannot trigger a request on every focus event", async () => {
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 })); await render();
  responses.push(Response.json({ error: "Unavailable" }, { status: 503 })); await focus();
  await focus(); await focus(); await focus();
  assert.equal(postCount, 2);
});

test("login retry respects the server cooldown without clearing a valid session", async () => {
  responses.push(success()); await render();
  responses.push(Response.json({ error: "Please wait before trying again." }, { status: 429, headers: { "Retry-After": "10" } }));
  await refresh();
  assert.equal(session.authenticated, true);
  assert.equal(session.isSyncing, false);
  assert.ok(timers.some((timer) => timer.active && timer.delay === 10_000));
  assert.equal(draftUnmounts, 0);
});

test("provider throttling waits for Retry-After and repeated clicks cannot bypass the cooldown", async () => {
  responses.push(success()); await render();
  responses.push(Response.json({ error: "The sign-in provider is busy." }, { status: 503, headers: { "Retry-After": "45" } }));
  await refresh();
  assert.equal(session.authenticated, true);
  assert.ok(timers.some((timer) => timer.active && timer.delay === 45_000));
  const requests = postCount;
  await refresh();
  await act(async () => session.login());
  assert.equal(postCount, requests, "manual retries do not make the upstream throttle worse");
  assert.match(session.error!, /provider is busy/);
  const originalNow = Date.now;
  const afterCooldown = originalNow() + 45_001;
  try {
    Date.now = () => afterCooldown;
    responses.push(success());
    await refresh();
    assert.equal(postCount, requests + 1);
    assert.equal(session.error, null);
  } finally { Date.now = originalNow; }
});

test("a newly available identity proof recovers from profile throttling without waiting or repeating the profile lookup", async () => {
  observedIdentityToken = null;
  identityToken = async () => null;
  responses.push(Response.json({ error: "Provider busy", code: "PRIVY_PROFILE_RATE_LIMITED" }, { status: 503, headers: { "Retry-After": "45" } }));
  await render();
  assert.equal(postCount, 1);
  assert.equal(postedBodies[0].identityToken, null);
  assert.equal(session.authenticated, false);

  observedIdentityToken = "new-signed-identity";
  responses.push(success());
  await render();
  assert.equal(postCount, 2);
  assert.equal(postedBodies[1].identityToken, "new-signed-identity", "recovery submits the proof that avoids the throttled endpoint");
  assert.equal(session.authenticated, true);
  assert.equal(session.error, null);
  assert.ok(!timers.some((timer) => timer.active && timer.delay === 45_000));
});

test("an identity proof arriving during a profile request is used after that request is throttled", async () => {
  const profileResponse = deferred<Response>();
  observedIdentityToken = null;
  identityToken = async () => null;
  responses.push(profileResponse.promise, success());
  await render();
  observedIdentityToken = "new-signed-identity";
  await render();
  assert.equal(postCount, 1, "the first request already used the profile fallback");
  await act(async () => {
    profileResponse.resolve(Response.json({ error: "Provider busy", code: "PRIVY_PROFILE_RATE_LIMITED" }, { status: 503, headers: { "Retry-After": "45" } }));
  });
  assert.equal(postCount, 2);
  assert.deepEqual(postedBodies.map((body) => body.identityToken), [null, "new-signed-identity"]);
  assert.equal(session.authenticated, true);
});

test("linked-account changes during verification request a fresh snapshot after it completes", async () => {
  const access = deferred<string>();
  accessToken = () => access.promise;
  responses.push(success(), success());
  await render();
  sdk = { ...sdk, user: { ...sdk.user, linkedAccounts: [...sdk.user.linkedAccounts, { type: "wallet", chainType: "ethereum", address: `0x${"2".repeat(40)}` }] } };
  await render();
  assert.equal(postCount, 0);
  await act(async () => { access.resolve("signed-access"); });
  assert.equal(postCount, 2);
  assert.deepEqual(postedBodies.map((body) => body.forceProfileRefresh), [undefined, true]);
  assert.equal(session.authenticated, true);
});

for (const [status, code] of [[429, "LOGIN_RATE_LIMITED"], [503, "PRIVY_VERIFICATION_UNAVAILABLE"]] as const) {
  test(`a newly available identity proof cannot bypass ${code} cooldowns`, async () => {
    observedIdentityToken = null;
    identityToken = async () => null;
    responses.push(Response.json({ error: "Please wait", code }, { status, headers: { "Retry-After": "45" } }));
    await render();
    observedIdentityToken = "new-signed-identity";
    await render();
    await refresh();
    assert.equal(postCount, 1);
    assert.equal(session.authenticated, false);
    assert.equal(session.isSyncing, false);
    assert.ok(timers.some((timer) => timer.active && timer.delay === 45_000));
  });
}

test("a rejected recovery proof stops without repeatedly bypassing the provider cooldown", async () => {
  observedIdentityToken = null;
  identityToken = async () => null;
  responses.push(Response.json({ error: "Provider busy", code: "PRIVY_PROFILE_RATE_LIMITED" }, { status: 503, headers: { "Retry-After": "45" } }));
  await render();
  observedIdentityToken = "rejected-identity";
  responses.push(Response.json({ error: "Invalid token" }, { status: 401 }));
  await render();
  await render();
  await focus();
  await refresh();
  assert.equal(postCount, 2);
  assert.equal(session.authenticated, false);
  assert.equal(session.isSyncing, false);
  assert.equal(session.error, "Invalid token");
});
