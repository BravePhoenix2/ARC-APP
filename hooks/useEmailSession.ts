"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

export type EmailAccount = { id: string; email: string };
const sessionKey = ["auth", "email-session"] as const;
export const EMAIL_SESSION_CHANGED = "artiq:email-session-changed";
const knownAccounts = new WeakMap<QueryClient, string | null>();
const pendingRefreshes = new WeakMap<QueryClient, Promise<void>>();
const refreshVersions = new WeakMap<QueryClient, number>();
const pendingSignOuts = new WeakMap<QueryClient, Promise<void>>();
const latestAuthEvents = new WeakMap<QueryClient, Event>();

function clearPrivateQueries(queryClient: QueryClient) {
  const filter = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === "submissions" || query.queryKey[0] === "admin-submissions" };
  void queryClient.cancelQueries(filter);
  queryClient.removeQueries(filter);
}

async function readEmailSession({ signal }: { signal?: AbortSignal }): Promise<EmailAccount | null> {
  const response = await fetch("/api/auth/email/session", { credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 401) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Could not check your email sign-in.";
    throw new Error(message);
  }
  if (!body || typeof body !== "object" || !("user" in body) || !body.user || typeof body.user !== "object" || !("id" in body.user) || !("email" in body.user) || typeof body.user.id !== "string" || typeof body.user.email !== "string") {
    throw new Error("Could not check your email sign-in.");
  }
  return { id: body.user.id, email: body.user.email };
}

/** Email authentication is established by the server's HttpOnly session cookie. */
export function useEmailSession() {
  const queryClient = useQueryClient();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: readEmailSession,
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    retry: false,
  });
  const user = query.isError ? null : query.data ?? null;

  useEffect(() => {
    if (!query.isFetched) return;
    const accountId = user?.id ?? null;
    if (knownAccounts.has(queryClient) && knownAccounts.get(queryClient) !== accountId) clearPrivateQueries(queryClient);
    knownAccounts.set(queryClient, accountId);
  }, [queryClient, user?.id, query.isFetched]);

  const refresh = useCallback(async ({ afterAuthChange = false }: { afterAuthChange?: boolean } = {}): Promise<void> => {
    const pending = pendingRefreshes.get(queryClient);
    if (pending && !afterAuthChange) return pending;
    const version = (refreshVersions.get(queryClient) ?? 0) + 1;
    refreshVersions.set(queryClient, version);
    const request = (async () => {
      // An older session response may describe cookies from before verification.
      // Abort it before reading the server's current authentication state.
      await queryClient.cancelQueries({ queryKey: sessionKey, exact: true }, { revert: false });
      // A newer authentication change can supersede this refresh while aborting.
      if (refreshVersions.get(queryClient) !== version) return;
      await queryClient.invalidateQueries({ queryKey: sessionKey, exact: true }, { cancelRefetch: false });
    })();
    pendingRefreshes.set(queryClient, request);
    try {
      await request;
    } finally {
      if (pendingRefreshes.get(queryClient) === request) pendingRefreshes.delete(queryClient);
    }
  }, [queryClient]);

  useEffect(() => {
    const refreshAfterEvent = (event: Event) => {
      // Each mounted hook receives the same browser event. Only its first
      // listener starts a new authentication read; the others share that read.
      const afterAuthChange = latestAuthEvents.get(queryClient) !== event;
      latestAuthEvents.set(queryClient, event);
      void refresh({ afterAuthChange });
    };
    const onEmailChange = (event: Event) => { setSignOutError(null); refreshAfterEvent(event); };
    const onWalletChange = (event: Event) => {
      // Wallet verification replaces email authentication on the server.
      queryClient.setQueryData(sessionKey, null);
      clearPrivateQueries(queryClient);
      refreshAfterEvent(event);
    };
    window.addEventListener(EMAIL_SESSION_CHANGED, onEmailChange);
    window.addEventListener("artiq:wallet-session-changed", onWalletChange);
    return () => {
      window.removeEventListener(EMAIL_SESSION_CHANGED, onEmailChange);
      window.removeEventListener("artiq:wallet-session-changed", onWalletChange);
    };
  }, [queryClient, refresh]);

  const signOut = useCallback(async (): Promise<boolean> => {
    setSignOutError(null);
    setIsSigningOut(true);
    try {
      let request = pendingSignOuts.get(queryClient);
      if (!request) {
        request = (async () => {
          const response = await fetch("/api/auth/email/session", { method: "DELETE", credentials: "same-origin", cache: "no-store" });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(typeof body?.error === "string" ? body.error : "Could not sign out. Please try again.");
          }
          await queryClient.cancelQueries({ queryKey: sessionKey, exact: true }, { revert: false });
          queryClient.setQueryData(sessionKey, null);
          clearPrivateQueries(queryClient);
          window.dispatchEvent(new Event(EMAIL_SESSION_CHANGED));
        })();
        pendingSignOuts.set(queryClient, request);
      }
      try { await request; } finally { if (pendingSignOuts.get(queryClient) === request) pendingSignOuts.delete(queryClient); }
      return true;
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause.message : "Could not sign out. Please try again.");
      return false;
    } finally {
      setIsSigningOut(false);
    }
  }, [queryClient]);

  return {
    user,
    account: user,
    isAuthenticated: Boolean(user),
    isLoading: query.isPending,
    isSigningOut,
    error: signOutError ?? (query.error instanceof Error ? query.error.message : null),
    refresh,
    signOut,
  };
}
