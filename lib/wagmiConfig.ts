import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { arcChain, arcConfig } from "./arcConfig";

// EIP-6963 discovers each installed wallet independently. Explicit targets
// support older extensions without routing every choice to window.ethereum.
const browserConnectors = [
  injected({ target: "metaMask" }),
  injected({ target: { id: "rabby", name: "Rabby", provider: "isRabby" } }),
  injected({ target: "coinbaseWallet" }),
  injected({
    target: {
      id: "trustWallet",
      name: "Trust Wallet",
      provider(window) {
        const providers = window?.ethereum?.providers ?? [window?.ethereum];
        return providers.find((provider) => provider?.isTrust || provider?.isTrustWallet);
      },
    },
  }),
  injected({ target: "phantom" }),
  injected(),
];

export const wagmiConfig = createConfig({
  chains: [arcChain],
  transports: {
    [arcChain.id]: http(arcConfig.rpcUrl),
  },
  connectors: browserConnectors,
  multiInjectedProviderDiscovery: true,
  // Renders the disconnected state on both the server and the first client
  // paint, then syncs real wallet state after hydration — otherwise
  // useAccount()'s isConnecting flips true on mount before the server ever
  // saw it, and React throws a hydration mismatch on this exact button.
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
