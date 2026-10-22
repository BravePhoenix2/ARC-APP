# Capacity and production readiness

These changes reduce work; they do not establish a capacity of one million users. One million registered accounts and one million simultaneous sessions require very different infrastructure. Agree on peak concurrent users, requests per second, upload volume, and latency/error targets before sizing production.

Implemented:

- Catalog requests default to 48 items, capped at 100. Timestamp/ID keyset cursors avoid deep offset scans and preserve ordering when timestamps tie. Public projections explicitly select catalog fields. Clients render one page at a time, cancel obsolete requests, and expire unused query pages after a minute.
- Catalog responses allow shared CDN caching for 15 seconds. Discovery and the public leaderboard use Next's data cache and shared response caching for 30–60 seconds. Private session responses are unchanged. Public counts and mint availability can briefly lag; transaction endpoints must remain authoritative.
- Composite catalog indexes are declared in the Prisma schema. Apply them through the existing schema deployment process before measuring performance. They have not been applied to the current database by this change.

Remaining production work:

1. Migrate the SQLite database to a managed database suitable for multiple app instances. This requires a provider/adapter change, data migration, SQL compatibility checks, backup/restore validation, and a bounded connection pool. Merely changing DATABASE_URL is insufficient. Local SQLite and database-backed image blobs remain major constraints.
2. Move image bytes to object storage with a CDN and thumbnail variants; migrate existing uploads while preserving URLs. Add upload quotas and distributed rate limits to expensive/authentication endpoints.
3. Move screening and chain verification workloads that exceed request budgets to durable jobs. Define retry limits, idempotency, and monitoring. Audit nonce consumption and purchase/mint races under concurrent writes.
4. Move search/filter/sort to indexed server queries. Current gallery filters operate on the visible page, as disclosed in the UI. Creator profiles and reviewer/submission lists still need bounded pagination.
5. Precompute leaderboard scores/ranks and aggregate counters for large populations. Caching reduces repeat scans but cold ranking queries still scan the tester population. Share cache storage across instances, configure CDN behavior, and monitor cache hit rates.
6. Add deployment metrics: API latency percentiles, error rates, database wait time, pool utilization, event loop lag, RPC quotas, and queue depth. Establish alerts and test recovery from database, RPC, email, and identity-provider outages.

## Repeatable public read smoke load

Install k6 separately and run `k6 run -e BASE_URL=https://your-staging-host test/load/public-api.js` against a dedicated staging environment with production-like data. The default ramps to 100 virtual users and checks a 1% error budget and p95 latency below one second. This is a starting smoke load, not a million-user simulation. The script has not been run as part of local validation.

Seed staging with realistic catalog and tester sizes, then increase arrival rates until latency or error thresholds fail. Test warm and cold caches, deep catalog pagination, authenticated writes with isolated test identities, burst sign-ins, uploads, RPC failures, and multi-hour soak traffic. Record host/database sizes, data volumes, traffic mix, cache hit rates, throughput, and latency before claiming capacity.

## Login reliability

Privy verification now has a 20-second client deadline covering SDK token reads, pending cookie revocation, HTTP verification, and response parsing. A timeout releases the loading state and ignores late results. Temporary failures retry at most twice with exponential delay and jitter; rejected credentials and account-selection responses require user action. A valid unexpired session remains available during a temporary verification outage, while private APIs continue checking its server cookie.

Missing identity tokens use the existing server-verified Privy profile fallback directly. Concurrent refresh callers share a request. Focus-triggered retries are limited to once per 30 seconds, and scheduled renewal happens once per token expiry with a randomized 60–90 second lead. Logout bounds server revocation at 15 seconds and the complete operation at 30 seconds; a failure keeps the private UI locked and offers retry. Anonymous cookie cleanup skips database transactions.

Regression coverage uses deterministic SDK/network/clock fixtures, including stalled SDK and HTTP operations, late responses, retries, deduplication, unchanged-expiry renewal, and logout timeouts. These checks establish client behavior, not Privy provider throughput or production database capacity.
