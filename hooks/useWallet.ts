"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { type Config, type Connector, useAccount, useBalance, useConfig, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { arcChain } from "@/lib/arcConfig";
import { getWalletOptions } from "@/lib/walletOptions";
import { usePrivySession } from "@/hooks/usePrivySession";

export type WalletError =
  | { type: "no-wallet" }
  | { type: "rejected" }
  | { type: "wrong-network" }
  | { type: "unknown"; message: string };

// The navbar and Settings use separate hook instances. Keep wallet prompts
// exclusive across both, including the gap between connect and network switch.
const pendingWalletRequests = new WeakSet<Config>();
const networkAttempts = new WeakMap<Config, Map<string, WalletError | null>>();

function networkAttemptKey(connector: Connector | undefined, address: string | undefined, chainId: number | undefined) {
  return `${connector?.uid}:${address?.toLowerCase()}:${chainId}`;
}

function rememberNetworkAttempt(config: Config, key: string, error: WalletError | null) {
  let attempts = networkAttempts.get(config);
  if (!attempts) {
    attempts = new Map();
    networkAttempts.set(config, attempts);
  }
  attempts.set(key, error);
}

function isUserRejection(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: number; name?: string; message?: string; cause?: unknown };
    if (e.code === 4001 || e.name === "UserRejectedRequestError" ||
        (e.message && /user (rejected|cancelled|canceled|closed)|modal closed/i.test(e.message))) return true;
    current = e.cause;
  }
  return false;
}

function requestError(error: unknown, fallback: string): WalletError {
  return isUserRejection(error)
    ? { type: "rejected" }
    : { type: "unknown", message: error instanceof Error ? error.message : fallback };
}

/**
 * One-stop wallet hook: connection status, truncated address, live USDC
 * balance (USDC is Arc's native gas currency, so this is just the native
 * balance on Arc), and helpers to connect / switch network / disconnect.
 */
export function useWallet() {
  const privySession = usePrivySession();
  const config = useConfig();
  const { address, chainId, status, connector: activeConnector, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect: disconnectWallet } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);
  const requestingRef = useRef(false);
  const pendingConnections = useIsMutating({ mutationKey: ["connect"] });
  const pendingSwitches = useIsMutating({ mutationKey: ["switchChain"] });

  const isWrongNetwork = isConnected && chainId !== arcChain.id;

  useEffect(() => {
    if (isConnected && chainId === arcChain.id) {
      networkAttempts.delete(config);
      setError(null);
    }
  }, [chainId, config, isConnected]);

  const { data: balance, isLoading: isBalanceLoading, isError: isBalanceError, refetch: refetchBalance } = useBalance({
    address,
    chainId: arcChain.id,
    query: { enabled: isConnected && Boolean(address), refetchInterval: 15_000 },
  });

  const truncatedAddress = useMemo(() => {
    if (!address) return null;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }, [address]);

  const usdcBalance = isConnected && balance
    ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  const connect = useCallback(async (connector?: Connector): Promise<boolean> => {
    if (privySession.configured) {
      privySession.connectWallet();
      return false;
    }
    if (requestingRef.current || pendingWalletRequests.has(config) || isConnecting || isReconnecting) return false;
    requestingRef.current = true;
    pendingWalletRequests.add(config);
    setError(null);
    setIsRequesting(true);
    let attemptedNetwork: string | undefined;
    try {
      let preferred = connector;
      if (!preferred) {
        // Callers with a picker pass their selected connector explicitly.
        // Legacy callers can still use the first available browser wallet.
        for (const candidate of getWalletOptions(connectors)) {
          if (candidate.type === "injected" && await candidate.getProvider()) {
            preferred = candidate;
            break;
          }
        }
      }
      if (!preferred || (preferred.type === "injected" && !await preferred.getProvider())) {
        setError({ type: "no-wallet" });
        return false;
      }

      // Switch separately so a rejected switch leaves a usable connected
      // session with a visible network error and a retry/disconnect action.
      const connection = await connectAsync({ connector: preferred });
      if (connection.chainId !== arcChain.id) {
        attemptedNetwork = networkAttemptKey(preferred, connection.accounts[0], connection.chainId);
        rememberNetworkAttempt(config, attemptedNetwork, null);
        await switchChainAsync({ chainId: arcChain.id, connector: preferred });
      }
      return true;
    } catch (err) {
      const failure = requestError(err, "Failed to connect wallet.");
      if (attemptedNetwork) rememberNetworkAttempt(config, attemptedNetwork, failure);
      setError(failure);
      return false;
    } finally {
      requestingRef.current = false;
      pendingWalletRequests.delete(config);
      setIsRequesting(false);
    }
  }, [config, connectAsync, connectors, isConnecting, isReconnecting, privySession, switchChainAsync]);

  const switchToArc = useCallback(async () => {
    if (pendingWalletRequests.has(config)) return;
    pendingWalletRequests.add(config);
    const key = networkAttemptKey(activeConnector, address, chainId);
    rememberNetworkAttempt(config, key, null);
    setError(null);
    try {
      await switchChainAsync({ chainId: arcChain.id, connector: activeConnector });
    } catch (err) {
      const failure = requestError(err, "Failed to switch network.");
      rememberNetworkAttempt(config, key, failure);
      setError(failure);
    } finally {
      pendingWalletRequests.delete(config);
    }
  }, [activeConnector, address, chainId, config, switchChainAsync]);

  const ensureArc = useCallback(async () => {
    if (!isConnected || chainId === arcChain.id || pendingWalletRequests.has(config)) return;
    const key = networkAttemptKey(activeConnector, address, chainId);
    const attempts = networkAttempts.get(config);
    if (attempts?.has(key)) {
      setError(attempts.get(key) ?? null);
      return;
    }
    await switchToArc();
  }, [activeConnector, address, chainId, config, isConnected, switchToArc]);

  return {
    address,
    connectors,
    activeConnector,
    chainId,
    status,
    truncatedAddress,
    isConnected,
    isConnecting: isRequesting || isConnecting || isReconnecting || pendingConnections > 0,
    isWrongNetwork,
    isSwitching: isSwitching || pendingSwitches > 0,
    usdcBalance,
    usdcBalanceRaw: isConnected ? balance?.value : undefined,
    isBalanceLoading,
    isBalanceError,
    refetchBalance,
    connect,
    switchToArc,
    ensureArc,
    disconnect: () => {
      setError(null);
      networkAttempts.delete(config);
      if (privySession.configured) void privySession.logout();
      else disconnectWallet();
    },
    error,
    clearError: () => setError(null),
  };
}
