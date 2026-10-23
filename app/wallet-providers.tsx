"use client";

import { type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { WagmiProvider } from "wagmi";
import { privyWagmiConfig, wagmiConfig } from "@/lib/wagmiConfig";
import { arcChain } from "@/lib/arcConfig";
import { privyAppId, privyClientId } from "@/lib/privyClient";
import PrivyAuthProvider, { UnconfiguredPrivyAuthProvider } from "@/components/PrivyAuthProvider";
import { AppAccessGate } from "@/components/AppEntry";

export default function WalletProviders({ children }: { children: ReactNode }) {
  if (privyAppId) {
    return <PrivyProvider appId={privyAppId} clientId={privyClientId} config={{
      loginMethods: ["email", "wallet"],
      supportedChains: [arcChain],
      defaultChain: arcChain,
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      appearance: {
        theme: "dark",
        accentColor: "#F14B94",
        walletChainType: "ethereum-only",
        logo: "/brand/artic-wordmark-dark.svg",
      },
    }}>
      <PrivyWagmiProvider config={privyWagmiConfig}>
        <PrivyAuthProvider><AppAccessGate>{children}</AppAccessGate></PrivyAuthProvider>
      </PrivyWagmiProvider>
    </PrivyProvider>;
  }

  return <WagmiProvider config={wagmiConfig}>
    <UnconfiguredPrivyAuthProvider><AppAccessGate>{children}</AppAccessGate></UnconfiguredPrivyAuthProvider>
  </WagmiProvider>;
}
