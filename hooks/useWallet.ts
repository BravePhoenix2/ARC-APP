"use client";

import { useCallback, useMemo, useState } from "react";
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { formatUnits } from "viem";
import { arcChain } from "@/lib/arcConfig";

export type WalletError =
  | { type: "no-wallet" }
  | { type: "rejected" }
  | { type: "wrong-network" }
  | { type: "unknown"; message: string };

function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; name?: string } | undefined;
  return e?.code === 4001 || e?.name === "UserRejectedRequestError";
}

/**
 * One-stop wallet hook: connection status, truncated address, live USDC
 * balance (USDC is Arc's native gas currency, so this is just the native
 * balance on Arc), and helpers to connect / switch network / disconnect.
 */
export function useWallet() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [error, setError] = useState<WalletError | null>(null);

  const isWrongNetwork = isConnected && chainId !== arcChain.id;

  const { data: balance, isLoading: isBalanceLoading } = useBalance({
    address,
    chainId: arcChain.id,
    query: { enabled: Boolean(address) },
  });

  const truncatedAddress = useMemo(() => {
    if (!address) return null;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
  }, [address]);

  const usdcBalance = balance
    ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : null;

  const connect = useCallback(async () => {
    setError(null);

    const hasInjectedProvider = typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
    const preferred = connectors.find((c) => c.id === "injected") ?? connectors[0];

    if (!preferred) {
      setError({ type: "no-wallet" });
      return;
    }
    if (!hasInjectedProvider && preferred.type !== "walletConnect") {
      setError({ type: "no-wallet" });
      return;
    }

    try {
      // Requesting the Arc chainId here makes the connector prompt
      // wallet_addEthereumChain / wallet_switchEthereumChain automatically
      // when the wallet doesn't already have Arc added or selected.
      await connectAsync({ connector: preferred, chainId: arcChain.id });
    } catch (err) {
      if (isUserRejection(err)) {
        setError({ type: "rejected" });
      } else {
        const message = err instanceof Error ? err.message : "Failed to connect wallet.";
        setError({ type: "unknown", message });
      }
    }
  }, [connectAsync, connectors]);

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
    truncatedAddress,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    isWrongNetwork,
    isSwitching,
    usdcBalance,
    isBalanceLoading,
    connect,
    switchToArc,
    disconnect,
    error,
    clearError: () => setError(null),
  };
}
