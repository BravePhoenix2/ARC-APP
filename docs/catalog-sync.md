# Catalog availability during the public Testnet

Collection mint counts and art-sale availability come from Arc Testnet contract
state. A client cannot set counts or reopen a deployed collection or checkout
listing through the manual status API. Scheduled NFT badges open from the
verified deployment's saved opening time, without starting RPC calls on public
catalog requests.

After an in-app mint, `POST /api/items/[id]/sync` verifies the signed-in wallet's
successful receipt, target contract and matching mint event before refreshing
catalog counts. The same endpoint accepts verified art-purchase receipts, so a
purchase can be marked sold independently of saving delivery details. Failed
catalog synchronization never requires a second payment.

Run the server-side maintenance command **once a minute** on the deployed host
to recover missed requests, pick up transactions made outside the app, and mark
sold-out collections or purchased/cancelled art listings:

```sh
npm run catalog:sync
```

The command loads the server environment, processes at most 250 managed items by
default, and uses two workers. Each RPC request has a five-second timeout without
automatic retries. Concurrent in-process synchronization is capped at four, and
matching reads share a bounded 30-second cache. Invalid provenance, wrong chain,
or unavailable providers leave the existing catalog state unchanged.
The command stops starting work after 45 seconds and returns a continuation
cursor; already-started requests finish within their bounded request timeouts.

For more than 250 deployed items, increase the bounded run to at most 1,000:

```sh
npm run catalog:sync -- --limit 1000
```

If the output has a non-null `nextCursor`, schedule the next page using
`--cursor ITEM_ID` and retain that cursor in the scheduler, wrapping to the start
when it becomes null. A nonzero exit code means some verification failed or
another page remains; alert/retry rather than treating the catalog as current.
If `incomplete` is true with a null cursor, the time budget expired before any
items were checked; retry from the beginning.
Do not run multiple overlapping scheduled jobs. No public unauthenticated cron
endpoint exists.

The maintenance command uses only catalog addresses previously attached through
server receipt verification and their pinned original factory/art market. It
also checks the collection's factory registration and registry, or an art
listing's seller, item key and exact price. Old unverified imports are excluded.
It never copies a client-provided count, sold flag, wallet, RPC URL, or contract
address into the catalog. NFT counts cannot move backwards, and a stale unsold
snapshot cannot reopen an already purchased artwork.

The cron is part of the release setup. Local tests establish synchronization
behavior; configure and monitor the job on the final host before inviting public
testers.
