import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { NextRequest } from "next/server";
import ts from "typescript";
import type { PrivyAccount, PrivySession } from "../../hooks/usePrivySession";
import type { CreatorSession } from "../../lib/creatorSession";

// Render the real role-gated UI with deterministic session boundaries. No
// authentication provider, wallet, database, or network is contacted here.
const require = createRequire(import.meta.url);
const descriptors = ["window", "document"].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let session: PrivySession;
let renderer: ReactTestRenderer | undefined;

function compile<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const output = { exports: {} as T };
  new Function("require", "module", "exports", code)((name: string) => dependencies[name] ?? require(name), output, output.exports);
  return output.exports;
}

const reviewer: PrivyAccount = { id: "reviewer", email: "reviewer@example.com", walletAddress: null, walletAddresses: [], authMethod: "PRIVY", isAdmin: true };
const link = { default: ({ children, ...props }: React.PropsWithChildren) => React.createElement("a", props, children), __esModule: true };
const empty = { default: () => null, __esModule: true };
const wallet = { isConnected: false, isWrongNetwork: false, isConnecting: false, isSwitching: false, isBalanceLoading: false, isBalanceError: false, usdcBalance: null, error: null, ensureArc: async () => true };
const dependencies: Record<string, unknown> = {
  "next/link": link,
  "@/hooks/usePrivySession": { usePrivySession: () => session },
  "@/hooks/useArtiqAccount": { useArtiqAccount: () => ({ ...session, identity: session.user?.id ?? null, headers: {} }) },
  "@/hooks/useWallet": { useWallet: () => wallet },
  "@/hooks/useTheme": { useTheme: () => ({ preference: "system", setPreference: () => true }) },
  "@/components/Atmosphere": empty,
  "@/components/ArticLogo": empty,
  "@/components/WalletPicker": { walletErrorMessage: () => "Wallet unavailable" },
  "@/lib/arcConfig": { arcChain: { name: "Arc Testnet", id: 5042002, testnet: true, blockExplorers: { default: { url: "https://explorer.example" } } } },
  "@/lib/reviewerAccess": compile("../../lib/reviewerAccess.ts", {}),
};
const reviewerOnly = compile<{ default: React.ComponentType<React.PropsWithChildren<{ fallback?: React.ReactNode }>> }>("../../components/ReviewerOnly.tsx", dependencies);
dependencies["@/components/ReviewerOnly"] = { ...reviewerOnly, __esModule: true };
const ConnectWalletButton = compile<{ default: React.ComponentType }>("../../components/ConnectWalletButton.tsx", dependencies).default;
const SettingsPage = compile<{ default: React.ComponentType }>("../../app/settings/page.tsx", { ...dependencies, "@/components/ConnectWalletButton": empty }).default;

const notFoundError = new Error("NEXT_NOT_FOUND");
let cookieValues: Map<string, string>;
let verifiedSession: CreatorSession | null;
let verificationCalls: Array<{ request: NextRequest; bindRequest: boolean }>;
const pageGuard = compile<{ requireReviewerPage: () => Promise<CreatorSession> }>("../../lib/reviewerPage.ts", {
  "next/headers": { cookies: () => ({ get: (name: string) => cookieValues.has(name) ? { name, value: cookieValues.get(name) } : undefined, toString: () => Array.from(cookieValues).map(([name, value]) => `${name}=${value}`).join("; ") }) },
  "next/navigation": { notFound: () => { throw notFoundError; } },
  "@/lib/creatorSession": { getCreatorSession: async (request: NextRequest, bindRequest: boolean) => { verificationCalls.push({ request, bindRequest }); return verifiedSession; } },
  "@/lib/privyAuth": { PRIVY_SESSION_COOKIE: "artiq_privy_session" },
  "@/lib/emailAuth": { EMAIL_SESSION_COOKIE: "artiq_email_session" },
});
type GuardedLayout = { default: (props: React.PropsWithChildren) => Promise<React.ReactElement>; dynamic: string };
const layouts = ["../../app/admin/layout.tsx", "../../app/settings/protocol/layout.tsx"].map((path) => compile<GuardedLayout>(path, { ...dependencies, "@/components/ConnectWalletButton": empty, "@/lib/reviewerPage": pageGuard }));

beforeEach(() => {
  session = {
    configured: true, ready: true, authenticated: false, sdkAuthenticated: false, profile: null,
    authenticationState: "signed-out", user: null, error: null, isLoading: false, isSyncing: false,
    connectedWallets: [], pendingAccounts: [], login() {}, connectWallet() {},
    logout: async () => true, refresh: async () => false, selectWallet: async () => false, selectAccount: async () => false,
  };
  const events = new EventTarget();
  const eventMethods = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: eventMethods });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { ...eventMethods, innerWidth: 1024 } });
  cookieValues = new Map(); verificationCalls = []; verifiedSession = null;
});
afterEach(async () => {
  await act(async () => renderer?.unmount()); renderer = undefined;
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function mount(Component: React.ComponentType) {
  await act(async () => {
    if (renderer) renderer.update(React.createElement(Component));
    else renderer = create(React.createElement(Component));
  });
}
function hrefs() { return renderer!.root.findAllByType("a").map((node) => node.props.href as string); }
function authenticate(user: PrivyAccount) {
  Object.assign(session, { user, authenticated: true, sdkAuthenticated: true, authenticationState: "authenticated" });
}

test("reviewer UI requires an authenticated server-verified email role", async () => {
  const Content = () => React.createElement(reviewerOnly.default, null, React.createElement("span", null, "Internal tools"));
  await mount(Content);
  assert.equal(renderer!.toJSON(), null);
  authenticate({ ...reviewer, id: "user", email: "user@example.com", isAdmin: false });
  await mount(Content);
  assert.equal(renderer!.toJSON(), null);
  authenticate({ ...reviewer, email: null });
  await mount(Content);
  assert.equal(renderer!.toJSON(), null, "a wallet-only account cannot receive reviewer UI");
  authenticate({ ...reviewer, email: "   " });
  await mount(Content);
  assert.equal(renderer!.toJSON(), null, "an empty email cannot receive reviewer UI");
  session.user = reviewer; session.authenticated = false; session.authenticationState = "verifying";
  await mount(Content);
  assert.equal(renderer!.toJSON(), null, "SDK sign-in or a stale admin-shaped user cannot reveal internal UI");
  authenticate(reviewer);
  await mount(Content);
  assert.match(JSON.stringify(renderer!.toJSON()), /Internal tools/);
  session.authenticated = false; session.authenticationState = "signing-out";
  await mount(Content);
  assert.equal(renderer!.toJSON(), null, "internal UI disappears immediately when authentication is cleared");
});

test("settings keeps creator and personal tools while hiding reviewer and project controls from ordinary users", async () => {
  await mount(SettingsPage);
  for (const href of ["/apply", "/nfts/create"]) assert.ok(hrefs().includes(href));
  assert.ok(!hrefs().some((href) => href.startsWith("/admin") || href === "/settings/protocol"));
  authenticate({ ...reviewer, id: "user", email: "user@example.com", isAdmin: false });
  await mount(SettingsPage);
  assert.ok(!hrefs().some((href) => href.startsWith("/admin") || href === "/settings/protocol"));
  authenticate(reviewer);
  await mount(SettingsPage);
  assert.ok(hrefs().includes("/admin/submissions"));
  assert.ok(hrefs().includes("/settings/protocol"));
  session.authenticated = false; session.authenticationState = "verifying";
  await mount(SettingsPage);
  assert.ok(!hrefs().some((href) => href.startsWith("/admin") || href === "/settings/protocol"));
});

test("profile menu reveals reviewer links only for the authenticated reviewer email", async () => {
  authenticate({ ...reviewer, id: "user", email: "user@example.com", isAdmin: false });
  await mount(ConnectWalletButton);
  await act(async () => renderer!.root.findByProps({ "aria-label": "Open profile menu" }).props.onClick());
  for (const href of ["/watchlist", "/apply#my-applications", "/settings"]) assert.ok(hrefs().includes(href));
  assert.ok(!hrefs().some((href) => href.startsWith("/admin")));
  authenticate(reviewer);
  await mount(ConnectWalletButton);
  assert.ok(hrefs().includes("/admin/submissions"));
  assert.ok(hrefs().includes("/admin/security"));
  session.authenticated = false; session.authenticationState = "verifying";
  await mount(ConnectWalletButton);
  assert.ok(!hrefs().some((href) => href.startsWith("/admin")), "a stale reviewer snapshot cannot show private links");
});

test("reviewer pages reject anonymous and expired sessions before revealing internal content", async () => {
  verifiedSession = { userId: reviewer.id, email: reviewer.email, walletAddress: null, authMethod: "PRIVY", isAdmin: true };
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError);
  assert.equal(verificationCalls.length, 0, "anonymous navigation does not perform an authentication lookup");
  cookieValues.set("artiq_privy_session", "");
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError);
  assert.equal(verificationCalls.length, 0);
  cookieValues.set("artiq_privy_session", "expired-or-forged");
  verifiedSession = null;
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError);
  assert.equal(verificationCalls.length, 1);
});

test("reviewer page access uses the current verified cookie role, without trusting browser account headers", async () => {
  cookieValues.set("artiq_privy_session", "server-verified-cookie");
  verifiedSession = { userId: "user", email: "user@example.com", walletAddress: null, authMethod: "PRIVY", isAdmin: false };
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError);
  verifiedSession = { ...verifiedSession, userId: reviewer.id, email: null, isAdmin: true };
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError);
  verifiedSession = { ...verifiedSession, email: reviewer.email };
  assert.equal(await pageGuard.requireReviewerPage(), verifiedSession);
  const { request, bindRequest } = verificationCalls.at(-1)!;
  assert.equal(bindRequest, false, "browser page navigation authenticates the HttpOnly cookie without an account-ID header");
  assert.equal(request.cookies.get("artiq_privy_session")?.value, "server-verified-cookie");
  assert.equal(request.headers.get("x-artiq-account-id"), null);
  verifiedSession = { ...verifiedSession, isAdmin: false };
  await assert.rejects(pageGuard.requireReviewerPage(), (error) => error === notFoundError, "a revoked reviewer cannot reuse a previously authorized navigation");
});

test("both internal route layouts guard every direct visit and permit verified email reviewers", async () => {
  const children = React.createElement("span", null, "Internal dashboard");
  for (const layout of layouts) {
    assert.equal(layout.dynamic, "force-dynamic", "private page permissions cannot be cached as a public static page");
    await assert.rejects(layout.default({ children }), (error) => error === notFoundError);
    cookieValues.set("artiq_email_session", "verified-email-session");
    verifiedSession = { userId: reviewer.id, email: reviewer.email, walletAddress: null, authMethod: "EMAIL", isAdmin: true };
    const result = await layout.default({ children });
    assert.equal(result.props.children, children);
    verifiedSession = { ...verifiedSession, email: "user@example.com", isAdmin: false };
    await assert.rejects(layout.default({ children }), (error) => error === notFoundError);
    cookieValues.clear(); verifiedSession = null;
  }
});

test("cached internal routes unmount private content when the account changes or signs out", async () => {
  cookieValues.set("artiq_privy_session", "verified-reviewer-session");
  verifiedSession = { userId: reviewer.id, email: reviewer.email, walletAddress: null, authMethod: "PRIVY", isAdmin: true };
  for (const layout of layouts) {
    let mounts = 0; let unmounts = 0;
    const InternalDashboard = () => {
      React.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
      return React.createElement("span", null, "Private review and security data");
    };
    const cachedResult = await layout.default({ children: React.createElement(InternalDashboard) });
    const CachedRoute = () => React.cloneElement(cachedResult);
    authenticate(reviewer);
    await mount(CachedRoute);
    assert.match(JSON.stringify(renderer!.toJSON()), /Private review and security data/);
    assert.equal(mounts, 1);
    authenticate({ ...reviewer, id: "ordinary", email: "ordinary@example.com", isAdmin: false });
    await mount(CachedRoute);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Private review and security data|Reviewer dashboard|Request protection|Testnet project setup/);
    assert.match(JSON.stringify(renderer!.toJSON()), /Verify your account to continue/);
    assert.deepEqual(hrefs(), ["/marketplace"]);
    assert.equal(unmounts, 1, "switching accounts stops the private dashboard even when its server layout is cached");
    session.user = reviewer; session.authenticated = false; session.authenticationState = "verifying";
    await mount(CachedRoute);
    assert.equal(mounts, 1, "an old reviewer snapshot cannot remount private queries while verification is pending");
    authenticate(reviewer);
    await mount(CachedRoute);
    assert.equal(mounts, 2);
    session.authenticated = false; session.authenticationState = "signing-out";
    await mount(CachedRoute);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Private review and security data/);
    assert.equal(unmounts, 2);
    await act(async () => renderer?.unmount()); renderer = undefined;
  }
});
