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
- Marketplace search works across titles, descriptions, and creators in both modes, including mobile. Sidebar filter and sort controls are not wired up.
- Seed items lack images; use real catalog assets for release.
- Creator applications at `/apply` require a signed wallet session. Uploads and applications remain private until review; approval publishes an item atomically. Reviewers use `/admin/submissions` and the server-only `ARTIQ_ADMIN_WALLETS` allowlist (currently unconfigured at the user's request).
- Public item creation is disabled to prevent bypassing review. Status and mint-time mutations require verified creator ownership (status also permits reviewers).
- Original art requires an uploaded image, human-made declaration, creation details, server metadata screening, and a documented reviewer assessment before publication. AI-generated and AI-assisted NFTs remain allowed. Metadata checks cannot establish authorship. Optional Sightengine pixel analysis requires an owned account, server credentials, and explicit activation; it is disabled by default.
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
