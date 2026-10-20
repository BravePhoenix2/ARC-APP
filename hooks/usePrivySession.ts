"use client";

import { createContext, useContext } from "react";

export type PrivyAccount = {
  id: string;
  email: string | null;
  walletAddress: string | null;
  walletAddresses: string[];
  authMethod: "PRIVY";
  isAdmin: boolean;
};

export type PrivyAccountChoice = { id: string; label: string };

export type PrivySession = {
  configured: boolean;
  ready: boolean;
  /** Authentication requires both a current Privy identity and server verification. */
  authenticated: boolean;
  user: PrivyAccount | null;
  error: string | null;
  login: () => void;
  connectWallet: () => void;
  connectedWallets: { address: string; label: string }[];
  selectWallet: (address: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  refresh: () => Promise<boolean>;
  isLoading: boolean;
  isSyncing: boolean;
  pendingAccounts: PrivyAccountChoice[];
  selectAccount: (accountId: string) => Promise<boolean>;
};

const unconfiguredSession: PrivySession = {
  configured: false,
  ready: true,
  authenticated: false,
  user: null,
  error: null,
  login: () => undefined,
  connectWallet: () => undefined,
  connectedWallets: [],
  selectWallet: async () => false,
  logout: async () => true,
  refresh: async () => false,
  isLoading: false,
  isSyncing: false,
  pendingAccounts: [],
  selectAccount: async () => false,
};

export const PrivySessionContext = createContext<PrivySession>(unconfiguredSession);

/** Safe on pages where Privy has not been configured or mounted yet. */
export function usePrivySession(): PrivySession {
  return useContext(PrivySessionContext);
}
