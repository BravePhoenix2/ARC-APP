import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { arcChain, arcConfig } from "./arcConfig";

// MetaMask (and any other browser-extension wallet) connects fine through the
// standard `injected()` connector via window.ethereum — no extra SDK needed.
//
// wagmi's dedicated `metaMask()` and `walletConnect()` connectors pull in
// optional SDK peer dependencies ("@metamask/connect-evm",
// "@walletconnect/ethereum-provider") that aren't installed here. Next's
// webpack needs those resolvable on disk at build time even for connectors
// that are never instantiated, so importing either one breaks the build.
// To bring WalletConnect back: `npm install @walletconnect/ethereum-provider`,
// set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, then add
// `import { walletConnect } from "wagmi/connectors/walletConnect"` and
// `walletConnect({ projectId: ... })` to the connectors list below.

export const wagmiConfig = createConfig({
  chains: [arcChain],
  transports: {
    [arcChain.id]: http(arcConfig.rpcUrl),
  },
  connectors: [injected({ target: "metaMask" }), injected()],
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
