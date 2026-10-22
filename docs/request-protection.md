# Request protection and security metrics

Reviewer accounts can open `/admin/security` from the profile menu or review queue. The page shows origin requests, rate limited requests, capacity rejections, access-denied responses (401/403), and handler errors (5xx), grouped by fixed route names for the last 60 minute buckets. Refreshes run every 30 seconds. These are request counts, not a count of identified bots. CDN cache hits do not reach this monitor.

## How requests are protected

API handlers have per-client fixed-window quotas and per-process concurrency caps. Rejected requests receive HTTP 429, a Retry-After header, and private no-store responses. A busy route does not queue unlimited work. Concurrency slots remain held until the actual handler settles; a client disconnect does not falsely free a slot while provider/database work continues.

Validated accounts have additional quotas before expensive upload, screening, submission, watchlist, and chain-verification work. Account IDs or wallet addresses in request headers cannot choose the protected account; the existing server session/token verifier determines it. Privy login uses the cryptographically verified DID for its account quota. Requests remain subject to all existing authorization, signature, upload byte/count, review queue, and email-code checks.

Starting limits per minute (account quotas are independent for each fixed operation, so upload, review, and purchase activity do not consume each other’s budget):

| Work | Trusted client IP | Validated account | Concurrent work per process |
| --- | ---: | ---: | ---: |
| Reads | 600 | — | 128 |
| Session reads/logout | 1200 | — | 64 |
| Privy verification | 120 | 30 per verified DID | 24 |
| Wallet challenge/verification | 60 | — | 16 |
| Legacy email send | 30 | Existing persisted email quotas | 8 |
| Upload | 600 | 240, plus existing hourly storage quotas | 8 |
| Submission | 120 | 20, plus existing pending queue cap | 4 |
| Chain verification and collection mutations | 120 | 30 | 16 |
| Watchlist and review actions | 600 | 120 | 32 |
| Optional preview screening | 30 | — | 2 |

Validated accounts also have concurrency limits: two uploads, one submission/screening, two chain-verification operations, or four watchlist/review actions per fixed operation. A single account cannot occupy every expensive worker slot. Session reads/logout have a separate capacity budget from public reads.

Trusted IPs also have lower concurrency caps before reading bodies: eight login requests, four uploads/chain checks, two submissions, or one preview screening per IP. This reserves process slots for other IPs when one source opens slow requests. Privy login JSON has a ten-second total body-read budget.

An ordinary 100-image collection upload stays within the upload budget. A fixed window can permit a burst on either side of its boundary; concurrency caps still apply. Tune these initial values against actual traffic and observed rejection rates. Client error responses from existing durable quota checks also contribute to rate-limit metrics when they return 429.

Body readers cap bytes before buffering, including missing Content-Length. They stop on a 15-second idle period or 60-second total read, with a 10-second total budget for legacy authentication JSON. The item status endpoint also uses bounded JSON parsing.

## Trusted ingress

`ARTIQ_TRUSTED_PROXY=cloudflare` uses only CF-Connecting-IP. `vercel` uses only X-Vercel-Forwarded-For. Otherwise only the platform-provided request IP is eligible. Invalid IPs and multi-value headers are rejected as identifiers. IPv6 spellings and IPv4-mapped addresses are normalized. Arbitrary X-Forwarded-For headers are ignored.

Only enable a proxy mode when direct access to the origin is restricted to that trusted proxy. The shared preview command binds `127.0.0.1` and selects Cloudflare mode automatically for a trycloudflare.com host. An internet-accessible origin with a spoofable trusted header would let attackers evade IP limits.

When no trustworthy IP is available, anonymous IP quotas are skipped rather than putting all visitors in one low-budget 'unknown' bucket. Validated-account quotas and process concurrency protection remain active. The dashboard makes an unconfigured proxy visible. Configure trusted ingress before relying on anonymous request limits.

## One instance and multiple instances

With no shared store, quotas and metrics are bounded, in-memory, per-process state. They reset on restart. The local limiter isolates IP and account budgets for each fixed work policy, keeping at most 5,000 buckets per policy/identity class. Public browsing churn cannot fill login/account quota storage. It prunes expired quotas without evicting live ones and bounds metrics to 60 minute buckets with fixed labels. If its key capacity is reached, requests creating new buckets receive a short 429 until expired slots are reclaimed.

For shared quotas and metrics, configure an HTTPS Redis-compatible REST endpoint using `ARTIQ_SECURITY_REDIS_URL`, `ARTIQ_SECURITY_REDIS_TOKEN`, and the same random `ARTIQ_RATE_LIMIT_SECRET` (at least 32 characters) on every app instance. The endpoint must support Redis EVAL. Rate increments and expirations use an atomic Lua operation. Rate keys include a window ID; aggregate metric hashes expire after two hours. Use a dedicated Redis database/namespace and a geographically nearby service. Quota checks add REST calls when configured; measure their latency before rollout. Shared metrics flush as bounded aggregate batches at most once per second with only one flush in flight; successful responses and capacity rejections never wait for metric storage.

Keys contain HMAC digests, not raw IPs, user IDs, email addresses, tokens, cookies, or wallet addresses. Metrics contain only aggregate counts and fixed route names. No client identity list is exposed. Secrets stay server-side.

A shared-store request has a 300ms deadline. A store failure opens a 15-second circuit breaker and falls back to the warm bounded process limiter, preserving login availability. The dashboard marks this fallback as degraded and shows instance scope. Fallback counters cannot be retroactively combined across instances; shared metrics may undercount during outages, instance shutdown, or serverless suspension. The in-process batch timer is best effort; use a durable telemetry pipeline if lossless monitoring is required. Healthy shared quotas remain authoritative when a local fallback pool is full. Redis-backed quotas are shared; concurrency caps are deliberately per process. In-flight handlers appear in metrics after they finish, so do not interpret the dashboard as real-time concurrency telemetry.

This layer controls application-level request abuse. Put CDN/WAF connection and volumetric protections in front of the origin for distributed floods; application quotas do not establish million-user capacity or guarantee that every automated request can be identified.

## Verification

`npm run test:app` includes quota isolation/expiry, early rejection, spoofed headers, IPv6 normalization, concurrency cleanup, bulk-upload budgets, Redis responses/outages, slow bodies, and reviewer-only metric access. Use a dedicated staging deployment for traffic tests; the existing public load script can help check that ordinary reads continue to succeed.

Internal pages under `/admin` and `/settings/protocol` also verify the current reviewer email permission on the server and return 404 to other accounts. Reviewer-only navigation uses the same server-verified session role and stays hidden while authentication is pending. Creator-owned collection controls remain separate.
