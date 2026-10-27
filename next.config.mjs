import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
      ],
    }];
  },
  // Build shared previews separately so the running app stays available.
  distDir: process.env.ARTIQ_LOCAL_BUILD === "true" ? ".next-local" : process.env.ARTIQ_SHARED_BUILD === "true"
    ? (process.env.ARTIQ_SHARED_BUILD_SLOT === "b" ? ".next-preview-b" : ".next-preview")
    : ".next",
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
