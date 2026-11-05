# Go-live review — November 5, 2026

**Decision: not ready for public release with the current configuration.** Most application features exist, but there are reproducible release failures, deployed-contract incompatibilities, and operational checks still to complete. The supported release is a **public Arc Testnet pilot**. Real-money trading is a separate release: the transaction hook and server verifiers deliberately restrict these flows to chain 5042002.

This review inspected application/API and contract code, local configuration presence, the local database in read-only mode, current tests, a fresh npm advisory audit, and read-only calls to the configured Arc Testnet contracts. No application fixes, schema changes, deployments, wallet transactions, or external messages were performed. Local settings do not prove what an independently hosted deployment uses.

## Verification results

| Check | Current result |
| --- | --- |
| `npm run lint` | Pass; Next's lint wrapper reports its deprecation. |
| `npm run test:app` | **310 passed**, zero failures/skips. These are application tests, not a full browser/live-service acceptance test. |
| `npm test` | **60 passed** on the local Hardhat network. The first sandboxed run could not obtain the compiler-cache lock; the rerun with cache access passed. |
| `npm run typecheck` | **Fails** on two test typing errors; see priority 1. |
| `npm run build` | **Pass** with network access. The initial restricted-network attempt fails fetching Google Fonts. Standalone typecheck still fails after the successful build. |
| `npm audit --omit=dev` | **24 affected package entries: 21 high, 3 moderate, 0 critical.** Includes inherited dependency findings, not 24 distinct confirmed application exploits. |
| SQLite integrity | `PRAGMA quick_check` returns `ok`; current catalog indexes exist. This does not test backup, restore, or hosting durability. |
| Configured chain/contracts | Chain 5042002 responds; all three configured protocol addresses contain code, but required new interfaces are missing. See priority 2. |
| Local production HTTP smoke | Home, NFT catalog, marketplace, settings, apply, auctions, and catalog API return 200 with security headers. Anonymous session, watchlist, and review API requests return 401. Reviewer-page content was also checked separately because Next can stream not-found responses with HTTP 200. This is not a hosted browser/login acceptance test. |

Evidence: [current dependency audit](../security/evidence/go-live-npm-audit-2026-11-05.json), [live contract and metadata checks](../security/evidence/go-live-rpc-2026-11-05.json), [local HTTP smoke checks](../security/evidence/go-live-http-2026-11-05.json). The older launch/security reports describe previous dependency versions and must not be used as current verification.

## Changes required before launch

### 1. Fix the release TypeScript failures

- `test/auth/reviewer-visibility.test.ts:186`: `result.props` is `unknown` under the installed React typings.
- `test/nft/deployment-api.test.ts:124`: `beforeEach` supplies a `TestContext | SuiteContext`, so accessing `t.mock` without narrowing is a type error.

Correct the test types/context usage and rerun typecheck and the standard production build. The tests execute successfully, but the files remain included in the project TypeScript configuration. Next's build and standalone TypeScript checking have different diagnostic coverage; a successful build does not clear the standalone typecheck failure. Keep release type checking enabled. The build also fetches Raleway through `next/font/google` (`app/layout.tsx:4–7`); allow that build-time dependency or bundle the font locally for reproducible offline builds.

### 2. Deploy protocol contracts compatible with this app

Read-only RPC checks of the addresses in the local configuration found:

| Configured contract | Observed compatibility |
| --- | --- |
| Studio factory | Code exists; mint phases and image series are supported. `supportsMintSurcharge()`, `mintSurchargeBps()`, `feeRecipient()`, and `platformFeeBps()` revert. |
| Art market | Code exists; fee-recipient and platform-fee getters revert. |
| Auction house | Code exists; `supportsAssetAuctions()` and fee getters revert. Its factory and art-market references match the configured older contracts. |

The current collection UI rejects a factory without mint-surcharge support (`components/CollectionDetail.tsx:42–45,79`), as does server deployment verification (`lib/deploymentVerification.ts:23`). Digital/physical asset-auction methods are unavailable on the configured older auction house. Supported legacy fee handling does not add these new capabilities or enable the intended revenue terms.

Back up the database and pin original collection factories/art markets **before** replacing configuration. Deploy the current compatible contracts, verify capability flags and immutable treasury/rates, retain the old auction house for existing claims/refunds/rewards, then rebuild with the new public addresses. Validate both new and retained contracts. Contract deployment is still outstanding; this review sent no transactions.

### 3. Establish durable hosting, domain, authentication, and schema release steps

The local environment uses a temporary `trycloudflare.com` app URL and `file:./prisma/dev.db`. The application is explicitly wired to the SQLite adapter (`lib/prisma.ts:1–7`), and upload bytes are stored in the same database (`app/api/uploads/route.ts:30`).

- Choose the permanent HTTPS domain and align `NEXT_PUBLIC_APP_URL`, any `ARTIQ_APP_ORIGIN` override, Privy allowed origins, and reviewer email configuration. Verify email/external-wallet login, wallet linking/switching, refresh, logout, and ordinary-account rejection from reviewer pages on that domain.
- **Both existing deployed collections already embed a temporary metadata host.** Live `metadataURI()` calls return the host `comment-announcements-var-plate.trycloudflare.com`, while both database metadata overrides are null. Changing the app origin will not change those on-chain URLs. Preserve the old endpoint if possible or replace the pilot/demo collections with an explicit migration decision. Set a permanent domain or durable pinned metadata before new deployments. Generated metadata URLs use the canonical app domain (`lib/itemMetadata.ts:2–13`), while NFT contracts retain their URI without a setter.
- For a small pilot, a single server with a persistent SQLite volume can be sufficient. Test restart/redeploy persistence and a real backup restore, including uploaded artwork. Do not assume an ephemeral/serverless filesystem will preserve this data.
- For multiple application instances, migrate the SQLite provider/adapter and data, and use shared object storage. Changing `DATABASE_URL` alone is insufficient.
- Document and rehearse a backed-up schema upgrade. There is no checked-in migrations directory or local migration-history table; the scripts use `db push` plus manual additive SQL. The README asset-auction upgrade command block is empty (`README.md:122–126`). Avoid running demo seeding against the release database.

Hosting persistence, Privy dashboard settings, backups, and recovery were not established by this repository review.

### 4. Configure trusted ingress and request limits

`ARTIQ_TRUSTED_PROXY` is absent locally. On default Next Node requests, no direct client IP is supplied (`lib/abuseProtection.ts:33–40`), so visitors share `unidentified-client` (`:195`). That means shared read/login quotas and concurrency caps; one visitor can consume capacity for everyone.

Configure the supported Cloudflare/Vercel ingress mode, restrict direct origin access, and verify the actual deployed client-IP headers. Configure the Redis REST store and a shared rate-limit secret for multiple processes. In-memory quotas can serve a small single-process pilot. Update `docs/request-protection.md:40`, which still incorrectly states unknown-IP quotas are skipped.

### 5. Resolve or assess the remaining dependency advisories

The fresh production audit reports 21 high and 3 moderate package entries. The high dependency chains include Privy, wagmi, WalletConnect/Reown, `zod`, and URI-decoding dependencies. The currently installed Next version is 15.5.28; the old report's Next 14 critical finding is not the current result.

Choose compatible fixes and establish whether affected paths are shipped/reachable. Record mitigations for any retained finding and rerun auth/wallet regression checks plus the audit. npm suggests older major-package versions for some chains; those suggestions are not a validated upgrade plan. This review did not change dependencies.

### 6. Preserve transaction recovery across refreshes

Collection deployment and original-art checkout activation keep their recovery transaction hash in React state (`hooks/useProtocolTransaction.ts:20–31`, `components/CollectionDetail.tsx:65–95`, `components/ArtCheckout.tsx:70–72`). If the transaction succeeds but API attachment fails, refreshing loses the hash and can expose another deploy/listing action.

Persist pending/confirmed hashes keyed by account, item, operation, and chain; recover and verify them before allowing another transaction. Add an existing-transaction recovery input. Test rejected signatures, RPC timeouts, refresh, account switching, confirmed transactions with failed API saves, and retries that do not redeploy. Protocol setup and asset-auction flows already contain recovery patterns to reuse. Original-art purchase order recovery exists; preserve it.

### 7. Reconcile catalog state with the blockchain

Approval initializes `mintedCount=0`; collection deployment sets a status once (`app/api/admin/submissions/[id]/route.ts:63`, `app/api/items/[id]/deployment/route.ts:43`). Mint callbacks only refresh browser chain state (`components/CollectionDetail.tsx:121`). No later writer updates catalog minted counts. Scheduled drops and exhausted collections can retain misleading statuses.

Add bounded, receipt/event-based synchronization and time-derived availability for catalog counts/statuses. Art sold state is currently updated while saving the delivery order (`app/api/items/[id]/order/route.ts:63`), so confirmed purchases without a saved order can also leave stale public availability. Derive sale state from verified chain events independently of delivery completion. Constrain manual creator status changes (`app/api/items/[id]/status/route.ts:34–50`) so they cannot override authoritative on-chain availability.

### 8. Finish public-user privacy, delivery, and support handling

- Add accessible privacy information, pilot terms, support/contact, and clear delivery/refund/dispute expectations. No corresponding pages were found. Collecting emails, linked wallets, uploads, and delivery addresses makes this part of a usable public release.
- Physical checkout asks buyers to agree shipping details with the creator, but there is no contact/messaging workflow. Provide a workable shipping/contact mechanism or keep physical commerce outside the first release. Settlement releases seller funds before delivery; define the support process accordingly.
- Strip identifying EXIF/location metadata from public image derivatives after private screening. Currently original bytes are publicly served after approval (`app/api/uploads/[id]/route.ts:21`). This is a possible disclosure path; existing images were not shown to contain GPS data.
- Validate decoding and dimensions, add overall storage limits and abandoned-upload cleanup, monitor disk usage, and schedule bounded expired-session cleanup. Hourly upload limits do not limit long-term growth.

### 9. Complete release operations and hosted acceptance tests

Add automated release checks, uptime/error alerts, and a recovery runbook. No checked-in CI workflow, health route, error tracker, or backup/restore automation was found; external services may exist but were not verified. The reviewer request dashboard is useful but does not establish these operations.

On the final host, complete and retain evidence for:

- [ ] Clean lint, typecheck, application/contract tests, production build, and current dependency disposition.
- [ ] Restricted reviewer access and private applications, uploads, allowlists, watchlists, and delivery data.
- [ ] Submit → review → configure tier prices → lock → deploy → mint from another wallet → refresh → verify ownership.
- [ ] Standard 5 USDC paid mint: 5.10 buyer payment before gas, 4.875 creator proceeds, 0.225 combined platform fees; verify both withdrawals on-chain.
- [ ] Every enabled art/auction/reward flow, including failed/rejected transactions, refunds, settlement, claims, delivery access, and recovery after an API failure.
- [ ] Mobile/desktop wallet and embedded-wallet behavior, wrong network, insufficient funds, sign-out, and account switching.
- [ ] Restart/redeploy persistence, tested database restore, storage alerts, and provider outage behavior.
- [ ] Release catalog free of misleading demo availability and clear Testnet/no-monetary-value labels.

## Improvements after the blockers

- Search, price sorting, and several filters operate on the current catalog page (`hooks/useCatalogPage.ts:14–16`); move them to indexed server queries as the catalog grows.
- Replace or hide placeholder home metrics, improve share previews/item metadata, add sitemap/robots, and align brand naming and marketing with the pilot.
- Add durable background work and broader load/soak testing as traffic grows. No measured capacity is established by passing local unit tests.

## Suggested execution order

Fix release types and dependency disposition; establish the permanent domain, durable host, backup/schema procedure, and ingress; implement transaction recovery and catalog reconciliation; deploy compatible contracts while preserving previous references; then run the complete hosted Testnet acceptance flow and refresh the launch evidence. Keep real-money payments outside this pilot until a separate production-chain, contract, operational, and delivery review is completed.
