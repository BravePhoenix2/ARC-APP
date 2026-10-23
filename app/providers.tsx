"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivySessionContext, unconfiguredSession, type PrivySession } from "@/hooks/usePrivySession";
import { privyAppId } from "@/lib/privyClient";
import { AppAccessGate } from "@/components/AppEntry";

type WalletRuntime = ComponentType<{ children: ReactNode }>;

/** Render the page before downloading and initializing the wallet SDK. */
export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [Runtime, setRuntime] = useState<WalletRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadWallets = useCallback(() => {
    setError(null);
    void import("./wallet-providers").then((module) => setRuntime(() => module.default)).catch(() => {
      setError("Sign-in could not load. Check your connection and try again.");
    });
  }, []);

  useEffect(loadWallets, [loadWallets]);

  const loadingSession: PrivySession = {
    ...unconfiguredSession,
    configured: Boolean(privyAppId),
    ready: Boolean(error),
    isLoading: !error,
    authenticationState: error ? "signed-out" : "loading",
    error,
    login: loadWallets,
  };

  return <QueryClientProvider client={queryClient}>
    {Runtime ? <Runtime>{children}</Runtime> : <PrivySessionContext.Provider value={loadingSession}>
      <AppAccessGate>{children}</AppAccessGate>
    </PrivySessionContext.Provider>}
  </QueryClientProvider>;
}
