import type { Chain } from "viem";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002);
const isTestnet = ARC_CHAIN_ID === 5042002;
if (ARC_CHAIN_ID !== 5042 && !isTestnet) {
  throw new Error("NEXT_PUBLIC_ARC_CHAIN_ID must be 5042 (Mainnet) or 5042002 (Testnet).");
}
const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ??
  (isTestnet ? "https://rpc.testnet.arc.io" : "https://rpc.mainnet.arc.io");

export const arcChain: Chain = {
  id: ARC_CHAIN_ID,
  name: isTestnet ? "Arc Testnet" : "Arc",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: process.env.NEXT_PUBLIC_ARC_USDC_SYMBOL ?? "USDC",
  },
  rpcUrls: {
    public: { http: [ARC_RPC_URL] },
    default: { http: [ARC_RPC_URL] },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: process.env.NEXT_PUBLIC_ARC_BLOCK_EXPLORER_URL ??
        (isTestnet ? "https://explorer.testnet.arc.io" : "https://explorer.arc.io"),
    },
  },
  testnet: isTestnet,
};

export const arcConfig = {
  chain: arcChain,
  rpcUrl: ARC_RPC_URL,
  chainId: ARC_CHAIN_ID,
  nativeCurrency: arcChain.nativeCurrency,
};

export default arcConfig;
