"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { arcChain } from "@/lib/arcConfig";

export type WalletError =
  | { type: "no-wallet" }
  | { type: "rejected" }
  | { type: "wrong-network" }
  | { type: "unknown"; message: string };

function isUserRejection(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: number; name?: string; cause?: unknown };
    if (e.code === 4001 || e.name === "UserRejectedRequestError") return true;
    current = e.cause;
  }
  return false;
}

/**
 * One-stop wallet hook: connection status, truncated address, live USDC
 * balance (USDC is Arc's native gas currency, so this is just the native
 * balance on Arc), and helpers to connect / switch network / disconnect.
 */
export function useWallet() {
  const { address, chainId, status, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect: disconnectWallet } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<WalletError | null>(null);

  const isWrongNetwork = isConnected && chainId !== arcChain.id;

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

  const connect = useCallback(async () => {
    setError(null);

    setIsRequesting(true);
    try {
      const candidates = [...connectors].sort((a, b) => {
        const priority = (id: string) => id === "metaMask" || id === "io.metamask" ? 0 : 1;
        return priority(a.id) - priority(b.id);
      });
      let preferred;
      for (const connector of candidates) {
        if (connector.type === "injected" && await connector.getProvider()) {
          preferred = connector;
          break;
        }
      }
      if (!preferred) {
        setError({ type: "no-wallet" });
        return;
      }

      // Switch separately so a rejected switch leaves a usable connected
      // session with a visible network error and a retry/disconnect action.
      const connection = await connectAsync({ connector: preferred });
      if (connection.chainId !== arcChain.id) {
        await switchChainAsync({ chainId: arcChain.id });
      }
    } catch (err) {
      if (isUserRejection(err)) {
        setError({ type: "rejected" });
      } else {
        const message = err instanceof Error ? err.message : "Failed to connect wallet.";
        setError({ type: "unknown", message });
      }
    } finally {
      setIsRequesting(false);
    }
  }, [connectAsync, connectors, switchChainAsync]);

  const switchToArc = useCallback(async () => {
    setError(null);
    try {
      await switchChainAsync({ chainId: arcChain.id });
    } catch (err) {
      if (isUserRejection(err)) {
        setError({ type: "rejected" });
      } else {
        const message = err instanceof Error ? err.message : "Failed to switch network.";
        setError({ type: "unknown", message });
      }
    }
  }, [switchChainAsync]);

  return {
    address,
    chainId,
    status,
    truncatedAddress,
    isConnected,
    isConnecting: isRequesting || isConnecting || isReconnecting,
    isWrongNetwork,
    isSwitching,
    usdcBalance,
    usdcBalanceRaw: isConnected ? balance?.value : undefined,
    isBalanceLoading,
    isBalanceError,
    refetchBalance,
    connect,
    switchToArc,
    disconnect: () => { setError(null); disconnectWallet(); },
    error,
    clearError: () => setError(null),
  };
}
