# Vercel + managed PostgreSQL Testnet deployment

This runbook prepares the public **Arc Testnet pilot**, chain **5042002**. Test USDC has no monetary value. Mainnet and real-money payments require a separate release. Completing this document is not evidence that a deployment is already live.

Local preparation verified on **November 10, 2026**: schema consistency, lint and
TypeScript checks passed; **447 application tests** and **60 local contract tests**
passed. The Vercel production build passed with a PostgreSQL-generated client and
synthetic service settings. This did not connect to a managed database, apply
migrations, or exercise hosted sign-in/payments. Complete the acceptance checklist
below with the actual deployment configuration.

## 1. Prepare the Vercel project and permanent domain

Import this Git repository in Vercel and use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | Repository root (`.`), containing `package.json` |
| Node.js version | `24.x`, matching `package.json` |
| Install command | `npm ci` |
| Build command | `npm run build:vercel` |
| Output directory | Next.js default; leave the override unset |

`vercel.json` supplies the install/build settings and daily maintenance schedule. Vercel supports selecting Node 24 for builds and functions. [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

Choose the permanent HTTPS domain before creating new collections; examples below use `https://articmarket.xyz`. Add it to the Vercel project and complete its DNS configuration. Set both `NEXT_PUBLIC_APP_URL` and `ARTIQ_APP_ORIGIN` to that exact origin. Add the same origin to the Privy app's allowed origins and enable the intended email/Ethereum wallet login methods. Use the matching public Privy app/client IDs. [Privy origin allowlisting](https://blog.privy.io/blog/setting-a-secure-foundation)

Configure Vercel's **Production** environment before the production build. Public `NEXT_PUBLIC_*` variables are embedded during compilation, so changing the domain, Privy IDs or contract addresses requires rebuilding. Existing deployments do not inherit later environment changes. [Next.js environment variables](https://nextjs.org/docs/pages/guides/environment-variables), [Vercel environments](https://vercel.com/docs/environment-variables)

Keep local/temporary preview overrides unset on the host: `ARTIQ_LOCAL_PREVIEW`, `ARTIQ_PREVIEW_ORIGIN`, `ARTIQ_LOCAL_HTTP_ORIGIN` and `ARTIQ_LOCAL_BUILD`. Preview deployments should use separate databases and explicit authentication origins rather than the release database.

## 2. Configure private services

Use [`.env.testnet.example`](../.env.testnet.example) as the checklist. Enter actual values in Vercel's private environment settings; never commit credentials or add `NEXT_PUBLIC_` to server secrets.

| Variables | Required configuration |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL **pooled runtime** connection, using provider-verified TLS settings |
| `DIRECT_URL` | Direct/session PostgreSQL connection for schema migration and the one-time import |
| `ARTIQ_DATABASE_POOL_SIZE` | Start with `5`; budget total connections across scaled functions and provider limits |
| `ARTIQ_ADMIN_EMAILS` | Verified reviewer emails; ordinary accounts must remain excluded |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Public support address for tester reports and data requests |
| `ARTIQ_TRUSTED_PROXY` | `vercel` |
| `ARTIQ_SECURITY_REDIS_URL`, `ARTIQ_SECURITY_REDIS_TOKEN` | Compatible HTTPS Redis REST endpoint and its private token |
| `ARTIQ_RATE_LIMIT_SECRET` | Random server-only secret of at least 32 characters, shared by all instances |
| `CRON_SECRET` | Separate random server-only secret of at least 32 characters |
| `FEE_RECIPIENT_ADDRESS`, `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT` | Verified platform wallet; keep both consistent |
| `NEXT_PUBLIC_ARC_*`, protocol addresses | Verified Arc Testnet values; retain any previous auction-house addresses |
| `ARTIQ_AI_PIXEL_SCREENING` | `true` only with both `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`; otherwise `false` |

Shared Redis quotas are required for this Vercel deployment because functions scale independently; process-local limits cannot enforce one shared budget. Verify the actual trusted client-IP behavior after deployment. See [request protection](request-protection.md).

Choose one persistent upload mode explicitly:

- **Private Supabase Storage:** set `ARTIQ_UPLOAD_STORAGE=supabase`, `SUPABASE_URL`, server-only `SUPABASE_SERVICE_ROLE_KEY`, and `ARTIQ_SUPABASE_STORAGE_BUCKET`. Create a private bucket accepting PNG/JPEG/WebP, with a 4 MiB upload limit. The app continues to authorize image reads through `/api/uploads/:id`. [Supabase bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- **Database storage:** set `ARTIQ_UPLOAD_STORAGE=database`; sanitized image bytes remain in managed PostgreSQL. This avoids a separate bucket but increases database size and backup/egress costs. Never use a Vercel filesystem SQLite file for persistent data.

Changing storage mode does not move existing images. Keep bucket credentials while any retained record references that bucket. Back up PostgreSQL and storage objects separately. See [upload storage](upload-storage.md).

New uploads are capped at **4 MiB (4,194,304 bytes)** to leave multipart overhead below Vercel's **4.5 MB request/response limit**. Before importing old data, review images larger than **4,500,000 bytes**, including processed output sizes. Prepare smaller copies or explicitly replace pilot/demo items; do not delete existing records blindly. Object storage does not bypass the response limit while reads still pass through the app. [Vercel Function limits](https://vercel.com/docs/functions/limitations#request-body-size)

## 3. Migrate before deploying

Builds generate Prisma Client and validate configuration; they **do not apply migrations**. Use a fresh managed PostgreSQL database, with a server-owned role able to use the app tables. The migrations protect app tables from direct unauthenticated/browser database APIs; do not use an anonymous/browser role as the runtime database role.

Keep `.env.local` for local SQLite development. Create the ignored `.env.testnet.local` without overwriting an existing file, then fill it privately with the intended host configuration:

```sh
cp -n .env.testnet.example .env.testnet.local
```

Run administrative commands from the repository root with Node 24. `--env-file` loads the hosting values only into that command; existing exported shell variables take precedence, so remove conflicting overrides first.

```sh
node --env-file=.env.testnet.local --run db:generate
node --env-file=.env.testnet.local --run db:migrate
```

`db:migrate` executes `prisma migrate deploy` using `DIRECT_URL` when configured. It applies the checked-in PostgreSQL migration history, including `CollectionCreationPayment`. Do not run demo seeding, development `db push`, or database reset against the release database.

If retaining local records, pause all local content writers and take a consistent SQLite backup using SQLite's backup API; a raw copy of an active database can miss WAL contents. Preserve the untouched original and upgrade only a backed-up copy if the importer reports missing tables. Set `ARTIQ_SQLITE_SOURCE` in `.env.testnet.local` to that copy's absolute path.

Preview the copy first; this opens the source read-only and makes **no target connection or writes**:

```sh
node --env-file=.env.testnet.local scripts/migrate-sqlite-to-postgres.mjs
```

After reviewing counts and confirming writes remain paused, import into the new, migrated **empty** target:

```sh
node --env-file=.env.testnet.local scripts/migrate-sqlite-to-postgres.mjs --apply --writes-paused
```

The importer refuses nonempty app tables, uses one target transaction, and verifies row counts plus image byte totals. It reads each table by its actual primary key, preserving payment records keyed by `itemId`. Keep import evidence private. If it fails, investigate before retrying; do not clear an occupied target to force the copy.

Check the host configuration and live read-only chain/database state, then restore the local SQLite-generated client before resuming local work:

```sh
node --env-file=.env.testnet.local --import tsx scripts/check-vercel-config.ts
node --env-file=.env.testnet.local --import tsx scripts/check-testnet.ts
npm run db:generate
```

Vercel's build generates its own PostgreSQL client. Validate a database backup restore into a separate database before opening the pilot; compare catalog/payment counts and verify both private and published images. A code rollback does not undo database changes or blockchain transactions.

## 4. Confirm protocol and metadata behavior

The separate **5 test USDC collection creation fee** goes directly to the platform wallet and is verified by the app before attaching a new collection deployment. Confirmed credit survives deployment/API retries. Existing deployed collections owe no retroactive fee; gas is separate.

A verified legacy factory can remain in use: its mint/sale platform commission and buyer surcharge are zero. Do not advertise the new commission rates until compatible contracts and their immutable fee terms are verified. A temporary RPC failure must not be treated as proof of legacy terms. Digital/physical asset auctions remain unavailable on a legacy house without that capability; keep those actions disabled. Retain old houses for NFT claims, refunds and rewards.

Before replacing protocol addresses, back up the database and pin existing original factory/art-market references with `studio:pin-factories` under the original configuration. Contract replacement is a separate wallet-approved operation; this runbook performs none.

Existing collections may embed a temporary `trycloudflare.com` metadata host. These contracts have no metadata URI setter, and changing the app domain does not rewrite their on-chain URI. Preserve the old endpoint or make an explicit demo replacement decision before launch. New collection metadata must use the permanent domain or a durable metadata URI.

## 5. Enable and monitor scheduled jobs

The committed Vercel cron calls `GET /api/cron/maintenance` daily at nominal **03:00 UTC / 04:00 Africa/Lagos**. It removes eligible expired credentials in bounded batches and **never deletes uploads**. Schedule additional bounded runs if the credential backlog needs them.

Vercel supplies `Authorization: Bearer <CRON_SECRET>` for its cron requests. External jobs must supply that same header. Keep the secret in the scheduler's private configuration, never a query string. Redeploy after secret changes and verify a scheduled invocation succeeds; unsigned calls must fail. [Securing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)

Catalog reconciliation needs an **external scheduler every minute** calling `GET https://articmarket.xyz/api/cron/catalog` with the bearer header. Each request processes bounded work. Inspect `checked`, `failed`, `incomplete` and `nextCursor`; after a successful incomplete response, resume with `?cursor=<URL-encoded nextCursor>` until finished. On failure, retry the same requested cursor before advancing. Persist progress across runs, avoid overlapping chains, and alert on repeated failures. If incomplete with no cursor, retry from the beginning and investigate repeated lack of progress.

Alternatively, on a Vercel plan supporting per-minute jobs, explicitly add `{"path":"/api/cron/catalog","schedule":"* * * * *"}` to `vercel.json` and deploy. Large catalogs still need cursor-aware follow-up. **Hobby cron permits only once-daily schedules**, with approximate hourly precision; a per-minute cron would fail deployment on Hobby. The repository therefore includes only daily maintenance. [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)

Neither scheduled endpoint deletes uploaded artwork. Upload removal remains a separate manual maintenance window with backups, stopped content writers, and explicit operator review. Enable alerts for job failures, missing successful runs, database/storage growth, function failures and provider outages.

## 6. Release acceptance checklist

- [ ] Run `npm run release:verify`; build again with the final Vercel environment and retain the build/revision evidence.
- [ ] Resolve or document the exposure and mitigation of the current production audit: **13 high and 3 moderate package entries, zero critical** as of November 10, 2026. These inherited findings are not 16 proven exploits; their remaining runtime exposure is unresolved. Do not apply unreviewed automatic major-version downgrades.
- [ ] Verify the permanent HTTPS domain, email/external-wallet login, linked-wallet selection, refresh, logout and reviewer restrictions on the hosted deployment.
- [ ] Confirm migrated payment/schema records, private upload authorization, successful image reads, trusted ingress and shared quotas across function instances.
- [ ] Complete a hosted flow: save NFT setup → pay **5 test USDC** → verify payment → create collection → mint from a second wallet → refresh and confirm ownership, catalog state and creator balances.
- [ ] Exercise rejected signatures, wrong network, insufficient funds, reverted transactions, and a confirmed fee/deployment followed by an API failure. Refresh and recover using the saved hash without another payment or collection deployment.
- [ ] Verify actual immutable commission terms and withdrawals for every enabled payment flow; legacy zero-commission deployments must display their real terms. Keep unavailable asset-auction actions disabled.
- [ ] Verify ART BAZZAR upload/screening/manual review, mobile/desktop flows, support contact and visible Testnet labels.
- [ ] Confirm both schedulers run, cursor continuation completes, failures alert, and database/object backup restoration has been rehearsed.
- [ ] Record the deployed revision, host configuration, test receipts and persistence/restore evidence before announcing the public pilot.
