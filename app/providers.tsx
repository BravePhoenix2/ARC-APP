"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { WagmiProvider } from "wagmi";
import { privyWagmiConfig, wagmiConfig } from "@/lib/wagmiConfig";
import { arcChain } from "@/lib/arcConfig";
import { privyAppId, privyClientId } from "@/lib/privyClient";
import PrivyAuthProvider, { UnconfiguredPrivyAuthProvider } from "@/components/PrivyAuthProvider";

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  if (privyAppId) {
    return (
      <PrivyProvider
        appId={privyAppId}
        clientId={privyClientId}
        config={{
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
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PrivyWagmiProvider config={privyWagmiConfig}>
            <PrivyAuthProvider>{children}</PrivyAuthProvider>
          </PrivyWagmiProvider>
        </QueryClientProvider>
      </PrivyProvider>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <UnconfiguredPrivyAuthProvider>{children}</UnconfiguredPrivyAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
