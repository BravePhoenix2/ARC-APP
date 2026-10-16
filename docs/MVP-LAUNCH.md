# Artiq MVP launch

Target: launch before October 18, 2026 (Africa/Lagos). Aim to release October 17, leaving time for fixes.
User confirmed: an in-app Settings page and an end-to-end USDC purchase flow on Arc Testnet is required for a public testing pilot. User explicitly selected Testnet first; Mainnet is a separate later release.

## Included

- Responsive home and marketplace, light/dark/system appearance.
- Settings: appearance, wallet connection/disconnection, address copy, balance, Arc network status.
- Browse real artwork, search/filter/sort, and item detail pages.
- One complete NFT purchase/mint path using native USDC, with wallet confirmation, pending/success/failure states, receipt link, and verified on-chain ownership.
- Verified wallet authentication and creator-only mutations, or disable public mutations until authentication is ready.
- A persistent production database, catalog assets, deployed Testnet contracts, and a public URL.

## Defer

Auctions, offers, social feeds, notification delivery, advanced rarity tools, multi-chain support, and physical-art checkout/shipping. Physical art may be browsable without checkout for the first release.

## Current evidence

- Home/marketplace and wagmi wallet integration implemented; wallet requests covered by three connector tests.
- Settings implemented. TypeScript, lint, wallet connector tests, and the settings production build pass. Repeat the production build with final release environment variables before deployment.
- Arc Testnet selected: chain ID 5042002, native test USDC 18 decimals. Mainnet 5042 remains configurable for a later release. No public contract deployment or purchase has been verified.
- Contracts exist, but there is no frontend purchase flow or item detail route.
- Marketplace search, filter, and sort controls are not wired up.
- Seed items lack images; use real catalog assets for release.
- Item creation/status updates are unauthenticated. Mint-time mutation trusts a client-supplied wallet address and allows it to be omitted.
- Local database is SQLite. Hosting must preserve it or use a production database migration.
- Contract deployment defaults and native-USDC precision comments/tests need review against the selected release network.

## Delivery order

1. Finish settings and validate shared appearance behavior.
2. Release network: Arc Testnet. Select hosting target; verify RPC and contract deployment configuration.
3. Secure or disable mutation routes, implement item details and a single end-to-end purchase path.
4. Connect marketplace discovery controls, add actual catalog images, verify mobile and failure states.
5. Run type checks, build, wallet/contract tests, and a test wallet purchase with a verified receipt on Arc Testnet.
6. Deploy, verify production persistence and the public URL, then freeze feature scope.

## Release acceptance

- No active purchase button without a deployed, verified collection/marketplace contract.
- Prices use integer native units (18 decimal native USDC); do not confuse ERC-20 USDC precision with native gas precision.
- Never mark a purchase successful from a submitted transaction alone; wait for a successful receipt.
- Unauthorized callers cannot create or mutate another creator's items.
- Label the public pilot as Testnet and make clear that test USDC has no monetary value. Do not enable Mainnet purchases during the pilot.
- Funds remain in the user's wallet until they explicitly approve a purchase.
- Hosting survives restart/redeploy without losing catalog data.
- Check home, marketplace, settings, details, rejection, insufficient funds, wrong network, and failed transactions on mobile and desktop.
