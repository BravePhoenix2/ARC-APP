# Artiq local penetration test — 27 October 2026

## Result

The assessment found one high-priority dependency exposure and two reproducd
application weaknesses. Browser security headers also need hardening. No
authentication bypass, reviewer privilege escalation, private delivery disclosure,
or contract balance theft was reproduced within the tested scope.

| ID | Priority | Finding | Evidence level |
| --- | --- | --- | --- |
| F1 | High | Next.js 14.2.15 contains unpatched framework vulnerabilities | Installed/locked version and maintainer advisories; destructive exploits not run |
| F2 | Medium | Per-IP quotas silently disappear when client IP is unavailable | Reproduced with the installed Next adapter; supported by local HTTP observations |
| F3 | Medium | Existing NFT imports bypass contract ownership/settings verification | Reproduced through current submission, approval and public detail handlers with a disposable database |
| H1 | Low, hardening | HTML responses lack framing restrictions and other browser security headers | Observed on the cached production build; absent from current Next configuration |

## Scope and limitations

- Source: current workspace based on commit
  `fb97949bf721a748e92683f4d9b31b247103c6fd`, including pre-existing uncommitted changes.
- Reviewed Next.js API routes, authentication/session/reviewer controls, uploads,
  private fulfillment, transaction verification, mint access and Solidity contracts.
- Authentication and integration tests use disposable databases; chain and email
  providers are mocked where the tests require them. Application catalog data was
  not changed. The HTTP fixture copied database schema only, with no user records.
- HTTP testing used an isolated copy of the existing `.next-local` build, whose
  `BUILD_ID` timestamp was **23 October 2026, 12:18 WAT**, on
  `http://127.0.0.1:4320`. It used an empty temporary SQLite database, no copied
  `.env` files, and disabled external service credentials. This was **not a fresh
  build of the current working tree**. Current source was tested directly by the
  application suite and the two focused proofs.
- A separate temporary development server stalled during compilation and was
  stopped. Its unsuccessful loopback WebSocket callback probe did not establish
  SSRF and is not counted as a confirmed finding.
- No public application, production database, email delivery, live chain
  transaction, destructive denial-of-service payload, or external SSRF target
  was tested. No hosted proxy/TLS configuration or browser wallet interaction
  was validated. Application code was not patched during this assessment.

## F1 — Unpatched Next.js dependency

**Evidence:** `package.json` pins Next.js and `eslint-config-next` to `14.2.15`;
the lockfile and installed Next.js agree. The app uses the App Router. The live
npm advisory query reported **69 vulnerable package findings: 1 critical,
35 high, 18 moderate and 15 low**, including development dependencies and
inherited dependency findings. These counts are not 69 proven application
exploits. Full machine-readable evidence: [npm-audit.json](evidence/npm-audit.json).

The maintainer's [Server Components denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-5j59-xgg2-r9c4)
includes this release. The [December 2025 security update](https://nextjs.org/blog/security-update-2025-12-11)
identifies App Router exposure and documents process hangs caused by crafted
requests. This establishes version/configuration exposure; a process-hanging
payload was deliberately not executed. Rating: High, based on the affected
runtime and upstream severity.

Important applicability distinctions:

- The critical middleware authorization advisory in npm's result is not evidence
  of an admin bypass here: no application middleware was found, sensitive APIs
  enforce authorization in their handlers, and the known middleware-subrequest
  header still returned `401` on the local admin API.
- No explicit Server Actions were found, and the inspected server reference
  manifest had no actions. The [October 2026 Server Actions advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
  explicitly excludes applications without Server Actions; that issue is not
  presented as reproduced or reachable in this app.
- Image optimizer, Windows, cache-function, rewrite and WebSocket advisories
  require individual deployment/feature validation. No remote code execution
  or SSRF was demonstrated. There is no installed `sharp` package in this lockfile,
  no configured remote image patterns, and catalog images use `unoptimized`.
- Other flagged packages include the Privy dependency tree, `ws`, PostCSS,
  Prisma's tooling tree and Hardhat's development tree. Their presence alone
  does not establish a remotely reachable exploit. The app does not expose an
  application WebSocket server or accept untrusted build-time CSS/ZIP input.

**Remediation:** migrate off Next.js 14 to a currently supported patched release,
align its React and ESLint dependencies, regenerate the lockfile, then rerun the
application, contract, type, lint and production-build checks. The
[14 October 2026 security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
documents patched supported branches at `15.5.28` and `16.4.1`; the audit captured
here recommends `16.4.3`. Recheck advisories at implementation time rather than
treating historical `14.2.35` guidance as sufficient today. Review transitive
updates individually; do not blindly apply `npm audit fix --force` or downgrade
Privy to the older version suggested by its audit entry.

## F2 — Missing client IP disables per-IP protection

**Locations:** [IP extraction](../lib/abuseProtection.ts#L33),
[conditional protection](../lib/abuseProtection.ts#L187).

Without `ARTIQ_TRUSTED_PROXY`, IP extraction uses `NextRequest.ip`. The installed
Next.js Node adapter does not populate that field. Missing or malformed trusted
IP headers also return `null`. The protection wrapper then skips both the IP
rate quota and the IP concurrency limit. Global concurrency and authenticated
account quotas remain in force.

The standalone proof uses the real installed Node adapter and the real wrapper,
with no database or network operations and a fixed time window:

| Scenario | Requests | Admitted | Rate limited |
| --- | --- | --- | --- |
| Default self-hosted Node request | 65 | 65 | 0 |
| Configured Cloudflare IP control | 65 | 60 | 5 |
| Configured proxy, malformed IP | 65 | 65 | 0 |

The cached HTTP build also returned `409` for all 65 invalid legacy wallet
challenge requests, with no `429`, despite the configured challenge policy of
60/minute. `409` means the configured Privy integration disabled legacy login;
it does not mean challenges were created. This HTTP observation supports the
quota gap and does not establish an authentication bypass.

**Impact:** an unauthenticated caller can bypass the intended per-IP request and
capacity protection in affected self-hosted or incorrectly configured ingress
deployments. No brute-force account compromise was demonstrated.

**Deployment nuance:** `.env.local.example` documents the trusted proxy option,
and `scripts/serve-shared-preview.mjs` configures it for its Cloudflare preview.
Correctly restricted proxy deployments with valid overwritten IP metadata pass
the control test. Missing a reliable identity should not silently turn off the
policy.

**Remediation:** require a supported ingress configuration in production; ensure
only the trusted proxy can reach the origin; strip/overwrite forwarded identity
headers there. Reject missing expected metadata or apply a bounded fallback
budget. Direct Node hosting needs a trusted socket-IP adapter. Never accept
arbitrary `X-Forwarded-For` as proof of identity. Add coverage through the actual
Node request adapter, including missing/malformed metadata.

Reproduce from the repository root:

```sh
node --import tsx security/poc/ip-rate-limit.mjs
```

Evidence: [ip-rate-limit.jsonl](evidence/ip-rate-limit.jsonl).

## F3 — NFT import publishes unverified ownership and token properties

**Locations:** [submission validation](../lib/submissionValidation.ts#L138),
[review publication](../app/api/admin/submissions/[id]/route.ts#L49),
[collection registry check](../components/CollectionDetail.tsx#L47),
[normal deployment verification](../lib/deploymentVerification.ts#L24).

A single-image NFT submission accepts any syntactically valid `contractAddress`.
Reviewer approval copies it into the public item alongside the applicant's
creator identity and declared token properties. This path does not invoke the
normal deployment verification of factory receipt, creator, owner, metadata,
mint settings, royalties or soulbound type.

The browser checks that the address has a nonzero registered creator in the
configured factory. It does not compare that creator with the listing's creator,
or verify the claimed NFT kind and royalties. Thus arbitrary unregistered
contracts may fail the browser guard, but another creator's genuinely registered
contract can still satisfy it. The UI reads the current mint price on-chain;
this finding does not claim checkout can override the contract's payment rules.

**Reproduction:** a disposable database contains one creator's collectible
contract-address fixture with 900 bps royalties. A different signed-in applicant
submits that same address as a soulbound collection with zero royalties. An
authorized reviewer approves it. The current handlers return:

```text
submission: 201
review approval: 200
anonymous public detail: 200
chain verification calls: 0
items sharing the contract: 2
```

The published item belongs to the applicant and states `SOULBOUND`, despite the
existing fixture belonging to someone else and stating `COLLECTIBLE`. The proof
uses an address fixture, **not a deployed contract**. API publication is executed;
the browser registry condition is assessed from source. It does not demonstrate
a live mint, theft of proceeds or control of the other creator's contract.

**Prerequisite/impact:** ordinary reviewer approval is required. This is a
catalog integrity and buyer deception weakness, not an admin authentication
bypass. It can misattribute a collection and advertise transfer restrictions or
royalties that do not match the contract.

**Remediation:** keep imported addresses unattached until the server verifies
the configured chain/factory, a session-bound creator wallet, actual creator/
ownership and advertised contract properties. Persist verified provenance and
reject duplicate chain/contract pairs, including case-normalized addresses.
If imported contracts cannot meet those checks, require the existing verified
deployment flow. Approval should not substitute for this automated verification.

Reproduce from the repository root; this creates and removes its own database:

```sh
node --import tsx security/poc/nft-import.mjs
```

Evidence: [nft-import.json](evidence/nft-import.json).

## H1 — Browser response-header hardening

The isolated cached HTML page returned `200` without `Content-Security-Policy`,
`X-Frame-Options`, `Referrer-Policy` or `X-Content-Type-Options`, and identified
itself through `X-Powered-By: Next.js`. Current `next.config.mjs` defines no
response-header policy. Upload responses separately use restrictive headers.

Set a framing policy such as CSP `frame-ancestors 'none'` and/or
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a deliberate referrer
policy, and disable the framework identification header. Introduce a broader
CSP with testing for Privy, wallets, image hosts and the existing inline theme
script. A browser clickjacking interaction was not executed. A hosting proxy
may already add headers; inspect the actual HTTPS deployment before closing
this observation. Missing HSTS on a loopback HTTP test is not treated as a finding.

## Verification and coverage

| Check | Result |
| --- | --- |
| `npm run test:app` | 294 passed, 0 failed |
| `npm test` | 60 passed, 0 failed on local Hardhat network |
| Bounded HTTP negative checks | 22 passed, 0 failed against cached isolated build |
| Adapter quota proof | Reproduced default/malformed-IP bypass and working trusted-IP control |
| NFT import proof | Reproduced unverified publication with no RPC calls |
| `npm audit --json --ignore-scripts` | Completed; exit 1 due to 69 vulnerable package findings |

The HTTP checks exercised anonymous admin/submission/watchlist/draft/fulfillment
access; origin rejection for writes; forged account headers and session cookies;
the middleware-subrequest header; disabled public catalog creation; bounded
catalog input validation; and non-serving of `.env.local`, `.git/config` and
`prisma/dev.db`. Responses and statuses: [http-checks.jsonl](evidence/http-checks.jsonl).

Source and existing isolated integration tests also cover OTP attempts, nonce
replay, revocable hashed sessions, verified Privy identity/linked wallets,
reviewer email revocation, private uploads, art orders, auction winner/seller
fulfillment, mint rosters and receipt verification. Solidity tests cover mint
caps/phases, soulbound transfer rejection, auctions/refunds/rewards, royalties,
reentrancy and fee/proceeds accounting. Passing tests constrain the tested
cases; they are not a proof that no other vulnerabilities exist.

The unbounded `items` relation on the public creator profile endpoint is a
lower-priority availability/scaling observation. No load exhaustion was
attempted. Reward farming across multiple wallets/free mints is already
documented as permitted and was not reported as an access-control flaw.

## Recommended order

1. Upgrade the affected framework and triage/update runtime dependencies.
2. Close the silent missing-IP protection path and verify the real ingress.
3. Require verified provenance for existing NFT imports and deduplicate addresses.
4. Apply browser header hardening and paginate creator-profile item responses.
5. Rerun the focused proofs as regression tests after fixes, rebuild from current
   source, and repeat authenticated browser/TLS checks on an authorized deployment.

The two focused proof scripts assert the vulnerable behavior; after remediation,
replace those assertions with rejection/limiting expectations. The HTTP harness
accepts only loopback targets and should run against a disposable app fixture.
