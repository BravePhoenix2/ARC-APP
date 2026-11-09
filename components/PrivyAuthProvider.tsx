"use client";

import { getIdentityToken, useIdentityToken, useLinkAccount, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { PrivySessionContext, type PrivyAccount, type PrivyAccountChoice, type PrivyAuthenticationState, type PrivyLoginOptions } from "@/hooks/usePrivySession";
import { PRIVY_SESSION_CHANGED, PRIVY_SETUP_MESSAGE } from "@/lib/privyClient";

const PRIVATE_QUERY_ROOTS = new Set(["submissions", "admin-submissions", "admin-security", "item-detail", "art-order", "tester-me", "watchlist", "mint-access"]);

function clearPrivateQueries(queryClient: QueryClient) {
  const filter = { predicate: (query: { queryKey: readonly unknown[] }) => PRIVATE_QUERY_ROOTS.has(String(query.queryKey[0])) };
  void queryClient.cancelQueries(filter);
  queryClient.removeQueries(filter);
}

function isAccount(value: unknown): value is PrivyAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Partial<PrivyAccount>;
  return typeof account.id === "string" && account.id.length > 0 &&
    (account.email === null || typeof account.email === "string") &&
    (account.walletAddress === null || typeof account.walletAddress === "string") &&
    Array.isArray(account.walletAddresses) && account.walletAddresses.every((wallet) => typeof wallet === "string") &&
    account.authMethod === "PRIVY" && typeof account.isAdmin === "boolean";
}

function accountChoices(value: unknown): PrivyAccountChoice[] {
  if (!Array.isArray(value)) return [];
  return value.filter((account): account is PrivyAccountChoice =>
    Boolean(account) && typeof account === "object" && typeof account.id === "string" && typeof account.label === "string");
}

// SDK promises need cancellation too: aborting fetch alone cannot release a
// stalled token read. Late SDK results never update the current session.
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("SESSION_REQUEST_ABORTED"));
    if (signal.aborted) { void work.catch(() => undefined); onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

type VerifiedSession = { binding: string; user: PrivyAccount; expiresAt: number };
type PendingSync = { binding: string; accountId?: string; forceProfileRefresh: boolean; controller: AbortController; promise: Promise<boolean> };
type SyncOptions = { identityProof?: string; forceProfileRefresh?: boolean };

/** Does not mount the SDK or make authentication requests without an app ID. */
export function UnconfiguredPrivyAuthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const login = useCallback(() => setError(PRIVY_SETUP_MESSAGE), []);
  const value = useMemo(() => ({
    configured: false,
    ready: true,
    authenticated: false,
    sdkAuthenticated: false,
    profile: null,
    authenticationState: "signed-out" as const,
    user: null,
    error,
    login,
    connectWallet: login,
    connectedWallets: [],
    selectWallet: async () => false,
    logout: async () => true,
    refresh: async () => false,
    isLoading: false,
    isSyncing: false,
    pendingAccounts: [],
    selectAccount: async () => false,
  }), [error, login]);
  return <PrivySessionContext.Provider value={value}>{children}</PrivySessionContext.Provider>;
}

/** Converts signed Privy tokens to a short-lived, server-verified Artiq session. */
export default function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated: sdkAuthenticated, user: sdkUser, getAccessToken, login: openLogin, logout: sdkLogout } = usePrivy();
  const { identityToken: observedIdentityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const queryClient = useQueryClient();
  const [verified, setVerified] = useState<VerifiedSession | null>(null);
  const verifiedRef = useRef(verified);
  verifiedRef.current = verified;
  const [isSyncing, setIsSyncing] = useState(false);
  const [retryDelay, setRetryDelay] = useState<number | null>(null);
  const retryCount = useRef(0);
  const retryAfterUntil = useRef(0);
  const profileCooldown = useRef(false);
  const lastSubmittedIdentityToken = useRef<string | null>(null);
  const lastObservedIdentityToken = useRef(observedIdentityToken);
  const observedIdentityTokenRef = useRef(observedIdentityToken);
  observedIdentityTokenRef.current = observedIdentityToken;
  const profileRecoveryToken = useRef<string | null>(null);
  const renewalAttemptedFor = useRef<number | null>(null);
  const lastFocusSync = useRef(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { linkWallet } = useLinkAccount({ onError: () => setError("Could not link this wallet. Please try again.") });
  const [pendingAccounts, setPendingAccounts] = useState<PrivyAccountChoice[]>([]);
  const generation = useRef(0);
  const pending = useRef<PendingSync | null>(null);
  const pendingRevocation = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const loggingOut = useRef(false);
  const suspended = useRef(false);
  const lastAccount = useRef<string | null>(null);
  const tokenGetter = useRef(getAccessToken);
  tokenGetter.current = getAccessToken;
  const invalidatePendingSync = useCallback(() => {
    ++generation.current;
    pending.current?.controller.abort();
    pending.current = null;
  }, []);

  // Privy's DID identifies the signed-in person. Linked-wallet updates refresh
  // server proofs without discarding an already verified email session.
  const linkedAccounts = sdkUser?.linkedAccounts.flatMap((account) => {
    if (account.type === "email") return [`email:${account.address.trim().toLowerCase()}`];
    if (account.type === "wallet" && account.chainType === "ethereum") return [`wallet:${account.address.toLowerCase()}`];
    return [];
  }).sort() ?? [];
  const identity = sdkUser ? JSON.stringify({
    id: sdkUser.id,
    accounts: Array.from(new Set(linkedAccounts)),
  }) : "";
  const binding = ready && sdkAuthenticated && sdkUser ? sdkUser.id : "";
  const lastLinkedIdentity = useRef({ binding, identity });
  const selectedWallet = address && linkedAccounts.includes(`wallet:${address.toLowerCase()}`) ? address : undefined;
  const current = useRef({ binding, ready, sdkAuthenticated, hasVerified: Boolean(verified), hasPendingChoice: pendingAccounts.length > 0 });
  current.current = { binding, ready, sdkAuthenticated, hasVerified: Boolean(verified), hasPendingChoice: pendingAccounts.length > 0 };

  const clearSession = useCallback(() => {
    setVerified(null);
    setPendingAccounts([]);
    if (lastAccount.current !== null) {
      clearPrivateQueries(queryClient);
      lastAccount.current = null;
      window.dispatchEvent(new Event(PRIVY_SESSION_CHANGED));
    }
  }, [queryClient]);

  const revokeServerSession = useCallback(async () => {
    if (pendingRevocation.current) return pendingRevocation.current;
    const request = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await abortable(fetch("/api/auth/privy/session", { method: "DELETE", credentials: "same-origin", cache: "no-store", signal: controller.signal }), controller.signal);
        if (!response.ok) {
          const body = await abortable(response.json(), controller.signal).catch(() => null);
          throw new Error(typeof body?.error === "string" ? body.error : "Could not sign out. Please try again.");
        }
      } catch (cause) {
        if (controller.signal.aborted) throw new Error("Sign-out took too long. Please try again.");
        throw cause;
      } finally { window.clearTimeout(timer); }
    })();
    pendingRevocation.current = request;
    try { await request; }
    finally { if (pendingRevocation.current === request) pendingRevocation.current = null; }
  }, []);

  const sync = useCallback(async (preferredAccountId?: string, options?: SyncOptions): Promise<boolean> => {
    const requestedBinding = current.current.binding;
    const identityProof = options?.identityProof;
    const forceProfileRefresh = options?.forceProfileRefresh === true;
    // A newly issued identity proof avoids the throttled profile endpoint.
    // Account/application rate limits still apply, and an unchanged proof
    // cannot repeatedly bypass a provider cooldown.
    const recoveringProfile = Boolean(identityProof && profileCooldown.current && profileRecoveryToken.current !== identityProof);
    if (Date.now() < retryAfterUntil.current && !recoveringProfile) return false;
    if (!requestedBinding || !current.current.ready || !current.current.sdkAuthenticated || loggingOut.current || suspended.current) return false;
    if (pending.current?.binding === requestedBinding && pending.current.accountId === preferredAccountId &&
        pending.current.forceProfileRefresh === forceProfileRefresh) return pending.current.promise;
    if (recoveringProfile) profileRecoveryToken.current = identityProof!;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const version = ++generation.current;
    setIsSyncing(true);
    setRetryDelay(null);
    setError(null);
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    const isLatest = () => mounted.current && version === generation.current && current.current.binding === requestedBinding && !loggingOut.current && !suspended.current;
    const isCurrent = () => isLatest() && !controller.signal.aborted;
    const request = (async () => {
      let invalidSession = false;
      let retryAfterMs = 0;
      try {
        // A previous unauthenticated render may still be clearing a cookie.
        // Let that response finish before a fresh sign-in writes its cookie.
        await abortable(pendingRevocation.current?.catch(() => undefined) ?? Promise.resolve(), controller.signal);
        if (!isCurrent()) return false;
        const accessToken = await abortable(tokenGetter.current(), controller.signal);
        if (!isCurrent()) return false;
        if (!accessToken) {
          invalidSession = true;
          throw new Error("Your sign-in has expired. Sign out and sign in again.");
        }
        const identityToken = identityProof ??
          (await abortable(getIdentityToken().catch(() => null), controller.signal) ?? observedIdentityTokenRef.current);
        if (!isCurrent()) return false;
        lastSubmittedIdentityToken.current = identityToken;
        // A missing identity token is supported by the server's authenticated
        // Privy profile lookup. Only Privy can attest email/wallet ownership;
        // the unsigned SDK user is never sent as an authentication substitute.
        const response = await abortable(fetch("/api/auth/privy/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          // Wallet selection is separate from account authentication. Private
          // transaction requests bind the selected, server-verified wallet.
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, identityToken, ...(preferredAccountId ? { preferredAccountId } : {}), ...(forceProfileRefresh ? { forceProfileRefresh: true } : {}) }),
          signal: controller.signal,
        }), controller.signal);
        const body = await abortable(response.json().catch(() => null), controller.signal);
        if (!isCurrent()) return false;
        if (response.status === 409 && body?.code === "ACCOUNT_SELECTION_REQUIRED") {
          clearSession();
          setPendingAccounts(accountChoices(body.accounts));
          setError("Choose the Artiq account you want to continue with.");
          return false;
        }
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) {
            const seconds = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(seconds) && seconds > 0) {
              retryAfterMs = Math.min(300_000, seconds * 1000);
              retryAfterUntil.current = Date.now() + retryAfterMs;
              profileCooldown.current = response.status === 503 && body?.code === "PRIVY_PROFILE_RATE_LIMITED";
            }
          }
          invalidSession = response.status < 500 && response.status !== 429;
          throw new Error(typeof body?.error === "string" ? body.error : "Could not verify your sign-in. Please try again.");
        }
        const expiresAt = typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
        if (!isAccount(body?.user) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          invalidSession = true;
          throw new Error("Could not verify your sign-in. Please try again.");
        }
        const accountId = `${requestedBinding}:${body.user.id}`;
        if (lastAccount.current !== accountId) clearPrivateQueries(queryClient);
        const changed = lastAccount.current !== accountId;
        lastAccount.current = accountId;
        retryCount.current = 0;
        retryAfterUntil.current = 0;
        profileCooldown.current = false;
        profileRecoveryToken.current = null;
        setVerified({ binding: requestedBinding, user: body.user, expiresAt });
        setPendingAccounts([]);
        setError(null);
        if (changed) window.dispatchEvent(new Event(PRIVY_SESSION_CHANGED));
        return true;
      } catch (cause) {
        if (!isLatest()) return false;
        const previous = verifiedRef.current;
        // A failed network/provider refresh does not revoke a previously
        // verified, unexpired session. Private APIs still check its cookie.
        if (invalidSession || !previous || previous.binding !== requestedBinding || previous.expiresAt <= Date.now()) clearSession();
        setError(timedOut ? "Sign-in took too long. Check your connection and try again." : cause instanceof Error ? cause.message : "Could not verify your sign-in. Please try again.");
        // Spread recovery traffic after an outage; never retry rejected credentials.
        if (!invalidSession && retryCount.current < 2) {
          const attempt = retryCount.current++;
          setRetryDelay(Math.max(retryAfterMs, 2_000 * 2 ** attempt + Math.floor(Math.random() * 1_000)));
        }
        return false;
      } finally {
        window.clearTimeout(deadline);
        if (version === generation.current && mounted.current) {
          pending.current = null;
          setIsSyncing(false);
        }
      }
    })();
    pending.current = { binding: requestedBinding, accountId: preferredAccountId, forceProfileRefresh, controller, promise: request };
    return request;
  }, [clearSession, queryClient]);

  const refresh = useCallback(() => {
    if (Date.now() < retryAfterUntil.current) return Promise.resolve(false);
    retryCount.current = 0;
    return sync(undefined, { forceProfileRefresh: true });
  }, [sync]);
  const selectAccount = useCallback((accountId: string) => {
    if (!pendingAccounts.some((account) => account.id === accountId)) return Promise.resolve(false);
    return sync(accountId);
  }, [pendingAccounts, sync]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidatePendingSync();
    };
  }, [invalidatePendingSync]);

  useEffect(() => {
    ++generation.current;
    pending.current?.controller.abort();
    pending.current = null;
    setIsSyncing(false);
    setRetryDelay(null);
    retryCount.current = 0;
    retryAfterUntil.current = 0;
    profileCooldown.current = false;
    lastSubmittedIdentityToken.current = null;
    profileRecoveryToken.current = null;
    renewalAttemptedFor.current = null;
    lastFocusSync.current = 0;
    clearSession();
    setError(null);
    if (!ready || loggingOut.current || suspended.current) return;
    if (binding) {
      void sync();
    } else {
      // Revoke a leftover Artiq cookie after Privy expires or signs out in
      // another tab. The UI never treats a cookie alone as authenticated.
      void revokeServerSession().catch(() => undefined);
    }
  }, [binding, clearSession, ready, revokeServerSession, sync]);

  useEffect(() => {
    if (lastLinkedIdentity.current.binding !== binding) {
      lastLinkedIdentity.current = { binding, identity };
      return;
    }
    if (!binding || lastLinkedIdentity.current.identity === identity || pending.current || current.current.hasPendingChoice) return;
    lastLinkedIdentity.current = { binding, identity };
    void sync(undefined, { forceProfileRefresh: true });
  }, [binding, identity, isSyncing, sync]);

  useEffect(() => {
    if (!binding || retryDelay === null || pendingAccounts.length || isLoggingOut) return;
    const timer = window.setTimeout(() => { void sync(); }, retryDelay);
    return () => window.clearTimeout(timer);
  }, [binding, isLoggingOut, pendingAccounts.length, retryDelay, sync]);

  // A token can arrive after the login callback. Resume verification rather
  // than leaving a successfully signed-in user at a second Sign in button.
  useEffect(() => {
    if (!observedIdentityToken) { lastObservedIdentityToken.current = null; return; }
    if (!binding || observedIdentityToken === lastObservedIdentityToken.current || pending.current) return;
    lastObservedIdentityToken.current = observedIdentityToken;
    if (observedIdentityToken === lastSubmittedIdentityToken.current || current.current.hasVerified || current.current.hasPendingChoice) return;
    void sync(undefined, { identityProof: observedIdentityToken });
  }, [binding, isSyncing, observedIdentityToken, sync]);

  useEffect(() => {
    if (!binding) return;
    const onFocus = () => {
      const active = verifiedRef.current;
      // Switching tabs need not hit Privy's current-user API again. Renewal
      // handles expiring sessions; explicit retries remain available.
      if (active?.binding === binding && active.expiresAt - Date.now() > 60_000) return;
      if (Date.now() - lastFocusSync.current < 30_000) return;
      lastFocusSync.current = Date.now();
      void sync();
    };
    const timer = window.setInterval(onFocus, 4 * 60_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [binding, sync]);

  useEffect(() => {
    if (!verified) return;
    // Renew before expiry so the review queue and unsaved notes stay mounted.
    // The separate expiry timer still locks the UI if renewal cannot succeed.
    const remaining = verified.expiresAt - Date.now();
    // A refreshed SDK token can retain its original expiry. Renew that expiry
    // once, rather than creating an accelerating loop of session writes.
    const lead = 60_000 + Math.floor(Math.random() * 30_000);
    const renewal = renewalAttemptedFor.current === verified.expiresAt ? null : window.setTimeout(() => {
      renewalAttemptedFor.current = verified.expiresAt;
      void sync();
    }, Math.max(1_000, remaining > lead ? remaining - lead : remaining / 2));
    const timer = window.setTimeout(() => {
      clearSession();
      void sync();
    }, Math.max(0, verified.expiresAt - Date.now()));
    return () => { if (renewal !== null) window.clearTimeout(renewal); window.clearTimeout(timer); };
  }, [clearSession, sync, verified]);

  const login = useCallback((options?: PrivyLoginOptions) => {
    if (Date.now() < retryAfterUntil.current) return;
    suspended.current = false;
    retryCount.current = 0;
    setError(null);
    if (sdkAuthenticated) {
      void sync();
      return;
    }
    openLogin(options);
  }, [openLogin, sdkAuthenticated, sync]);

  const connectWallet = useCallback(() => {
    suspended.current = false;
    setError(null);
    if (!sdkAuthenticated) openLogin();
    else linkWallet();
  }, [linkWallet, openLogin, sdkAuthenticated]);

  const connectedWallets = useMemo(() => wallets.filter((wallet) => verified?.user.walletAddresses.some((linked) => linked.toLowerCase() === wallet.address.toLowerCase())).map((wallet) => ({
    address: wallet.address,
    label: wallet.walletClientType === "privy" ? "Artiq wallet" : wallet.meta.name || "Connected wallet",
  })), [verified, wallets]);

  const selectWallet = useCallback(async (walletAddress: string): Promise<boolean> => {
    const wallet = wallets.find((candidate) => candidate.address.toLowerCase() === walletAddress.toLowerCase());
    const linked = verified?.user.walletAddresses.some((candidate) => candidate.toLowerCase() === walletAddress.toLowerCase());
    if (!wallet || !linked || !sdkAuthenticated || loggingOut.current) {
      setError("Choose a wallet linked to this account.");
      return false;
    }
    try {
      await setActiveWallet(wallet);
      return true;
    } catch {
      setError("Could not switch wallets. Please try again.");
      return false;
    }
  }, [sdkAuthenticated, setActiveWallet, verified, wallets]);

  const logout = useCallback(async (): Promise<boolean> => {
    if (loggingOut.current) return false;
    loggingOut.current = true;
    suspended.current = true;
    ++generation.current;
    pending.current?.controller.abort();
    pending.current = null;
    setIsSyncing(false);
    setRetryDelay(null);
    setIsLoggingOut(true);
    setError(null);
    clearSession();
    clearPrivateQueries(queryClient);
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 30_000);
    try {
      // Revoke the server's HttpOnly session before logging out of Privy.
      await revokeServerSession();
      await abortable(sdkLogout(), controller.signal);
      await abortable(disconnectAsync().catch(() => undefined), controller.signal);
      window.dispatchEvent(new Event(PRIVY_SESSION_CHANGED));
      return true;
    } catch (cause) {
      if (mounted.current) setError(controller.signal.aborted ? "Sign-out took too long. Please try again." : cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
      return false;
    } finally {
      window.clearTimeout(deadline);
      loggingOut.current = false;
      if (mounted.current) setIsLoggingOut(false);
    }
  }, [clearSession, disconnectAsync, queryClient, revokeServerSession, sdkLogout]);

  const user = binding && !isLoggingOut && verified?.binding === binding && verified.expiresAt > Date.now() ? verified.user : null;
  const signedIn = ready && sdkAuthenticated && Boolean(sdkUser) && !isLoggingOut && !suspended.current;
  const profile = useMemo(() => signedIn && sdkUser ? {
    id: sdkUser.id,
    email: sdkUser.email?.address ?? sdkUser.linkedAccounts.find((account) => account.type === "email")?.address ?? null,
    walletAddress: selectedWallet ?? sdkUser.wallet?.address ?? null,
  } : null, [sdkUser, selectedWallet, signedIn]);
  const authenticationState: PrivyAuthenticationState = !ready ? "loading" : isLoggingOut ? "signing-out" :
    !signedIn ? "signed-out" : user ? "authenticated" : isSyncing || !error ? "verifying" : "verification-error";
  const value = useMemo(() => ({
    configured: true,
    ready,
    authenticated: Boolean(user),
    sdkAuthenticated: signedIn,
    profile,
    authenticationState,
    user,
    error,
    login,
    connectWallet,
    connectedWallets,
    selectWallet,
    logout,
    refresh,
    isLoading: !ready || isLoggingOut || (sdkAuthenticated && isSyncing && !user),
    isSyncing,
    pendingAccounts,
    selectAccount,
  }), [authenticationState, connectWallet, connectedWallets, error, isLoggingOut, isSyncing, login, logout, pendingAccounts, profile, ready, refresh, sdkAuthenticated, selectAccount, selectWallet, signedIn, user]);

  return <PrivySessionContext.Provider value={value}>{children}</PrivySessionContext.Provider>;
}
