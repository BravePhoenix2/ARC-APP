export type ChainConfig = {
  chainId: number;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type WalletAddress = `0x${string}`;
