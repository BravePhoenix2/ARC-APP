import type { Chain } from "viem";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 12345);
const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.arc-testnet.com";

export const arcChain: Chain = {
  id: ARC_CHAIN_ID,
  name: "Arc",
  nativeCurrency: {
    decimals: 6,
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
      url: process.env.NEXT_PUBLIC_ARC_BLOCK_EXPLORER_URL ?? "https://explorer.arc-testnet.com",
    },
  },
  testnet: true,
};

export const arcConfig = {
  chain: arcChain,
  rpcUrl: ARC_RPC_URL,
  chainId: ARC_CHAIN_ID,
  nativeCurrency: arcChain.nativeCurrency,
};

export default arcConfig;
