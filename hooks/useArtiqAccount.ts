"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { usePrivySession } from "@/hooks/usePrivySession";

/** Server-verified identity and headers shared by private Artiq requests. */
export function useArtiqAccount() {
  const session = usePrivySession();
  const { address, isConnected } = useAccount();
  const walletAddress = isConnected ? session.user?.walletAddresses.find((wallet) => wallet.toLowerCase() === address?.toLowerCase()) : undefined;
  const accountId = session.user?.id;
  const headers = useMemo((): Record<string, string> => {
    if (!accountId) return {};
    return { "X-Artiq-Account-ID": accountId, ...(walletAddress ? { "X-Wallet-Address": walletAddress } : {}) };
  }, [accountId, walletAddress]);
  return { ...session, accountId, identity: accountId ?? null, walletAddress, headers };
}
