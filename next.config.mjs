import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Privy's wagmi bridge only uses injected. Its broad connector import also
    // pulls an unused Tempo connector that expects a different viem patch.
    config.resolve.alias = {
      ...config.resolve.alias,
      "wagmi/connectors$": require.resolve("wagmi/connectors/injected"),
    };
    // Privy loads these optional adapters for Solana, Abstract, or smart accounts.
    // Artiq uses standard Ethereum wallets on Arc.
    // https://docs.privy.io/basics/react/installation
    config.externals.push({
      "@solana/kit": "commonjs @solana/kit",
      "@solana-program/memo": "commonjs @solana-program/memo",
      "@solana-program/system": "commonjs @solana-program/system",
      "@solana-program/token": "commonjs @solana-program/token",
      "@farcaster/mini-app-solana": "commonjs @farcaster/mini-app-solana",
      "@abstract-foundation/agw-client": "commonjs @abstract-foundation/agw-client",
      permissionless: "commonjs permissionless",
    });
    return config;
  },
};

export default nextConfig;
