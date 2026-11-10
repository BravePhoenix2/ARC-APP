# Artiq public Testnet launch

> Historical October launch plan. Use [TESTNET-DEPLOYMENT.md](TESTNET-DEPLOYMENT.md) for the current Vercel/PostgreSQL setup and release checks. The older dependency versions, SQLite-only restriction, reviewer requirement for NFT creation, and test counts below are historical.

Confirmed target: **Monday, November 2, 2026 (Africa/Lagos)**. Release the public Arc Testnet pilot with a working Settings page and a complete native-USDC NFT mint path. Test USDC has no monetary value. Mainnet and real-money payments remain a separate release.

## Current implementation

- Responsive home, marketplace, appearance settings, wallet controls, account sign-in, and item detail pages are implemented.
- Marketplace search, filters, sorting, creator profiles, and watchlists are implemented. Catalog controls operate on loaded pages; this does not establish complete server-side search across the catalog.
- Creator applications, private uploads, review, collection deployment, and NFT minting are implemented. Public mint price and Ultimate/FCFS tier prices are independent; locking the allowlist freezes its prices, schedule, limits, and roster. Standard paid mints combine a 2.5% creator proceeds fee with a separate 2% buyer surcharge: a 5 USDC mint costs 5.10 USDC, pays 4.875 USDC to the creator, and accrues 0.225 USDC total to the platform before gas.
- Privy provides email and Ethereum-wallet sign-in. Protected mutations verify the account and creator ownership. Reviewers use verified emails in server-only `ARTIQ_ADMIN_EMAILS`; `ARTIQ_ADMIN_WALLETS` no longer grants access.
- ART BAZZAR requires an uploaded image, human-made declaration, creation details, metadata screening, and documented human review. AI-generated and assisted NFTs remain allowed. Optional Sightengine screening is disabled by default and does not replace review.
- Art checkout, asset/NFT auctions, and funded rewards are implemented. Availability depends on the configured deployed contracts. Seller payment does not escrow physical delivery. Local tests do not establish successful live transactions for these flows.
- SQLite stores the catalog, account state, and uploaded image bytes. The current Prisma adapter requires SQLite; changing only `DATABASE_URL` does not migrate the app to another provider.

## Local verification — October 26, 2026

- [x] `npm run lint` passed.
- [x] `npm run typecheck` passed.
- [x] `npm run test:app` passed: 284 application tests, including price edits, pending saves, public-only transitions, and rejection after Ultimate opens.
- [x] `npm test` passed: 56 contract tests on the local Hardhat network.
- [x] `npm run build` passed with network access for the build-time font, using the current local environment. Repeat with the final release environment.
- [x] Local production-server smoke checks passed: home, NFT gallery, marketplace, settings, creator application, and catalog API return 200; anonymous wallet-session, watchlist, and review API requests return 401.
- [x] `npm audit --omit=dev` completed. It reports 40 vulnerable package entries: 1 critical, 24 high, and 15 moderate. Dependency remediation and exposure review remain open.

These results cover local behavior. They do not verify hosting persistence, production authentication configuration, or deployed Arc Testnet receipts.

## Dependency release blocker

Resolve or document the application exposure and mitigation for the reported critical/high findings before public launch. Audit counts include findings propagated through nested dependencies; they are not counts of confirmed application exploits.

- Prioritize `next@14.2.15`, reported as critical. The audit includes authorization-bypass and image-optimization advisories. The app performs authorization in server handlers, and the production host is not yet selected; assess the actual affected paths. The suggested automatic fix upgrades Next.js to a new major version, requiring a reviewed migration and regression checks.
- Review direct high findings in `@privy-io/react-auth@3.50.0` and `prisma@7.9.1`, including their nested dependency paths. The suggested Privy fix is an older version, so an automatic force fix is not a validated remediation.
- Choose compatible dependency updates, repeat the audit, and rerun lint, TypeScript, application/contract tests, the production build, and runtime checks after changes. Preserve the verified mint-pricing change in its own commit.

## Required before public launch

- [ ] Close the dependency release blocker above and record the resulting audit and regression evidence.
- [ ] Select the hosting target and configure a persistent SQLite path. Back up the database, test a restore, and verify that catalog records and uploaded images survive an app restart and redeploy. Do not put the database on ephemeral storage.
- [ ] Apply required additive schema changes to the backed-up release database. Follow the existing-installation instructions in [README.md](../README.md) and confirm original contract references before replacing protocol addresses. Run `npm run studio:pin-factories` with the original factory and art-market configuration when upgrading existing deployments.
- [ ] Configure the final HTTPS app domain, `NEXT_PUBLIC_APP_URL`, Privy App ID and allowed origins, and reviewer `ARTIQ_ADMIN_EMAILS`. Verify email login, external-wallet login, refresh, wallet linking/switching, and sign-out on that domain. Verify reviewer access and rejection of an ordinary account.
- [ ] Configure trusted ingress for the chosen host. Verify trusted client IP handling before relying on anonymous IP quotas. Configure the shared quota store if using multiple app instances; see [request-protection.md](request-protection.md).
- [ ] Confirm Arc Testnet chain ID **5042002**, a working RPC, and all enabled protocol contract addresses. Verify the current factory reports buyer-paid mint surcharge support and verify all deployed fee terms. Retain original addresses for existing collections, auctions, refunds, and claims; existing contracts do not gain new fee behavior in place.
- [ ] Build with the final public environment, deploy the production build, and verify the public HTTPS URL. Rebuild after changing public contract addresses or authentication configuration.
- [ ] Complete a live Testnet flow: sign in, submit a collection, approve it, configure independent tier prices, lock the allowlist, deploy, and mint from another funded wallet. For a 5 USDC mint under the standard terms, confirm the minter pays 5.10 USDC before gas, the creator can withdraw 4.875 USDC, and the platform can withdraw 0.225 USDC. Confirm the successful receipt and on-chain ownership; verify the app records the result after refresh.
- [ ] Check home, marketplace, settings, review, details, and minting on mobile and desktop. Exercise rejected signatures, insufficient funds, wrong network, failed transactions, and retry after a confirmed transaction without paying twice. Verify locked/deployed tier prices cannot be edited.
- [ ] Check release catalog assets and visible Testnet labels. Verify every enabled payment flow has a deployed, verified contract; unavailable flows must not expose an active purchase action.

## Acceptance rules

- On-chain payment amounts use integer native units with **18 decimals** for native Arc Testnet USDC. Do not substitute ERC-20 USDC precision.
- A submitted transaction alone is not success. Require a successful receipt and the relevant ownership or event verification.
- Unauthorized accounts cannot create or mutate another creator's items or access private uploads, applications, allowlist rosters, or delivery details.
- Wallet transactions require the user's explicit approval. The public pilot remains clearly labeled Testnet and must not enable Mainnet purchases.
- Mint pricing must show the creator's price, the buyer-paid surcharge, the creator proceeds fee, both resulting payouts, and the total before wallet confirmation. Marketplace and auction fees remain deductions from seller proceeds.
- Record the final build, deployed configuration, live smoke-test receipts, and persistence check before marking the launch ready.
