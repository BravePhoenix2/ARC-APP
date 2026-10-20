"use client";

import { getIdentityToken, useIdentityToken, useLinkAccount, usePrivy, useUser, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { PrivySessionContext, type PrivyAccount, type PrivyAccountChoice, type PrivyAuthenticationState, type PrivyLoginOptions } from "@/hooks/usePrivySession";
import { PRIVY_SESSION_CHANGED, PRIVY_SETUP_MESSAGE } from "@/lib/privyClient";

const PRIVATE_QUERY_ROOTS = new Set(["submissions", "admin-submissions", "item-detail", "tester-me"]);

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

type VerifiedSession = { binding: string; user: PrivyAccount; expiresAt: number };
type PendingSync = { binding: string; accountId?: string; controller: AbortController; promise: Promise<boolean> };

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
  const { refreshUser } = useUser();
  const { identityToken: observedIdentityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const queryClient = useQueryClient();
  const [verified, setVerified] = useState<VerifiedSession | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
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
  const refreshSdkUser = useRef(refreshUser);
  refreshSdkUser.current = refreshUser;
  const invalidatePendingSync = useCallback(() => {
    ++generation.current;
    pending.current?.controller.abort();
    pending.current = null;
  }, []);

  // Only identity-bearing account fields change the security binding. Wallet
  // reconnects and SDK metadata refreshes must not reset an email session.
  const linkedAccounts = sdkUser?.linkedAccounts.flatMap((account) => {
    if (account.type === "email") return [`email:${account.address.trim().toLowerCase()}`];
    if (account.type === "wallet" && account.chainType === "ethereum") return [`wallet:${account.address.toLowerCase()}`];
    return [];
  }).sort() ?? [];
  const identity = sdkUser ? JSON.stringify({
    id: sdkUser.id,
    accounts: Array.from(new Set(linkedAccounts)),
  }) : "";
  const binding = ready && sdkAuthenticated ? identity : "";
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
      const response = await fetch("/api/auth/privy/session", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "Could not sign out. Please try again.");
      }
    })();
    pendingRevocation.current = request;
    try { await request; }
    finally { if (pendingRevocation.current === request) pendingRevocation.current = null; }
  }, []);

  const sync = useCallback(async (preferredAccountId?: string): Promise<boolean> => {
    const requestedBinding = current.current.binding;
    if (!requestedBinding || !current.current.ready || !current.current.sdkAuthenticated || loggingOut.current || suspended.current) return false;
    if (pending.current?.binding === requestedBinding && pending.current.accountId === preferredAccountId) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const version = ++generation.current;
    setIsSyncing(true);
    setError(null);
    const isCurrent = () => mounted.current && !controller.signal.aborted && version === generation.current && current.current.binding === requestedBinding && !loggingOut.current && !suspended.current;
    const request = (async () => {
      try {
        // A previous unauthenticated render may still be clearing a cookie.
        // Let that response finish before a fresh sign-in writes its cookie.
        await pendingRevocation.current?.catch(() => undefined);
        if (!isCurrent()) return false;
        const accessToken = await tokenGetter.current();
        if (!isCurrent()) return false;
        if (!accessToken) throw new Error("Your sign-in has expired. Sign out and sign in again.");
        let identityToken = await getIdentityToken().catch(() => null);
        if (!isCurrent()) return false;
        if (!identityToken) {
          // Privy may finish login before publishing its identity token. The
          // documented refresh also recovers sessions created before the app
          // enabled identity tokens; no unsigned SDK identity reaches the API.
          await refreshSdkUser.current().catch(() => undefined);
          if (!isCurrent()) return false;
          identityToken = await getIdentityToken().catch(() => null);
          if (!isCurrent()) return false;
        }
        // A missing identity token is supported by the server's authenticated
        // Privy profile lookup. Only Privy can attest email/wallet ownership;
        // the unsigned SDK user is never sent as an authentication substitute.
        const response = await fetch("/api/auth/privy/session", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          // Wallet selection is separate from account authentication. Private
          // transaction requests bind the selected, server-verified wallet.
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, identityToken, ...(preferredAccountId ? { preferredAccountId } : {}) }),
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!isCurrent()) return false;
        if (response.status === 409 && body?.code === "ACCOUNT_SELECTION_REQUIRED") {
          clearSession();
          setPendingAccounts(accountChoices(body.accounts));
          setError("Choose the Artiq account you want to continue with.");
          return false;
        }
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not verify your sign-in. Please try again.");
        const expiresAt = typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
        if (!isAccount(body?.user) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Could not verify your sign-in. Please try again.");
        const accountId = `${requestedBinding}:${body.user.id}`;
        if (lastAccount.current !== accountId) clearPrivateQueries(queryClient);
        const changed = lastAccount.current !== accountId;
        lastAccount.current = accountId;
        setVerified({ binding: requestedBinding, user: body.user, expiresAt });
        setPendingAccounts([]);
        setError(null);
        if (changed) window.dispatchEvent(new Event(PRIVY_SESSION_CHANGED));
        return true;
      } catch (cause) {
        if (!isCurrent()) return false;
        clearSession();
        setError(cause instanceof Error ? cause.message : "Could not verify your sign-in. Please try again.");
        return false;
      } finally {
        if (version === generation.current && mounted.current) {
          pending.current = null;
          setIsSyncing(false);
        }
      }
    })();
    pending.current = { binding: requestedBinding, accountId: preferredAccountId, controller, promise: request };
    return request;
  }, [clearSession, queryClient]);

  const refresh = useCallback(() => sync(), [sync]);
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

  // A token can arrive after the login callback. Resume verification rather
  // than leaving a successfully signed-in user at a second Sign in button.
  const hasIdentityToken = Boolean(observedIdentityToken);
  useEffect(() => {
    if (binding && hasIdentityToken && !pending.current && !current.current.hasVerified && !current.current.hasPendingChoice) void sync();
  }, [binding, hasIdentityToken, sync]);

  useEffect(() => {
    if (!binding) return;
    const onFocus = () => { void sync(); };
    const timer = window.setInterval(onFocus, 4 * 60_000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [binding, sync]);

  useEffect(() => {
    if (!verified) return;
    const timer = window.setTimeout(() => {
      clearSession();
      void sync();
    }, Math.max(0, verified.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [clearSession, sync, verified]);

  const login = useCallback((options?: PrivyLoginOptions) => {
    suspended.current = false;
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
    setIsLoggingOut(true);
    setError(null);
    clearSession();
    clearPrivateQueries(queryClient);
    try {
      // Revoke the server's HttpOnly session before logging out of Privy.
      await revokeServerSession();
      await sdkLogout();
      await disconnectAsync().catch(() => undefined);
      window.dispatchEvent(new Event(PRIVY_SESSION_CHANGED));
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
      return false;
    } finally {
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
