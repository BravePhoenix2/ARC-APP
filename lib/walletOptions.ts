import type { Connector } from "wagmi";

const walletAliases: Record<string, string> = {
  metaMask: "metamask",
  "io.metamask": "metamask",
  rabby: "rabby",
  "io.rabby": "rabby",
  coinbaseWallet: "coinbase",
  "com.coinbase.wallet": "coinbase",
  "com.coinbase": "coinbase",
  trust: "trust",
  trustWallet: "trust",
  "com.trustwallet": "trust",
  "com.trustwallet.app": "trust",
  phantom: "phantom",
  "app.phantom": "phantom",
};

/** Prefer the discovered wallet's exact provider and icon over its legacy fallback. */
export function getWalletOptions(connectors: readonly Connector[]): Connector[] {
  const wallets = new Map<string, Connector>();
  for (const connector of connectors) {
    const key = walletAliases[connector.id] ?? connector.id;
    const existing = wallets.get(key);
    if (!existing || connector.id.includes(".")) wallets.set(key, connector);
  }
  return Array.from(wallets.values());
}
