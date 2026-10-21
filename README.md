# Artic

Next.js marketplace with Prisma/SQLite and Solidity contracts.

## Discovery and watchlists

Use the bookmark buttons on marketplace cards and detail pages to save work to
`/watchlist`. Saved items belong to the verified account, remain private, and
sync across devices. A watchlist can hold up to 500 published items. Saving an
item does not reserve it or trigger a payment. Sign-in is required to save.

Creator names on detail pages open `/creators/[id]`, showing the creator's public
bio, wallet and published catalog. Contact emails, pending applications, sessions
and delivery details are excluded. Marketplace price, status, category/rarity and
sort controls apply to catalog data; unknown prices are excluded from price ranges
and sort last. Collection galleries support filename/token search and sorting.
Detail pages and creator profiles have share buttons with copy-link fallback.

## Testnet leaderboard and account count

`/leaderboard` ranks verified tester accounts and shows total accounts, accounts
active in the last seven days, and total points. Public rankings use generated
tester aliases; email addresses, full wallets, and private application details
are excluded. NFT and marketplace counters refresh every 30 seconds. The landing page has no
tester counter. Counts represent verified accounts, not distinct people. Seeded
marketplace users are excluded. Privy-linked identities share one Artiq account;
previous separate accounts are never merged automatically.

Each account earns each milestone once: verified sign-in (10), first approved
creator application (25), collection deployment (20), NFT mint (30), art purchase
(40), auction bid (15), joining a reward round (10), and claiming a reward (15).
The maximum is 165 points. Ties use join time, then the public profile ID.
Pending and rejected applications stay private and earn no creator milestone.
Points provide recognition; USDC reward eligibility remains a separate contract
check based on minting or buying art.

On-chain actions count only after the server verifies a successful receipt,
event, sender, contract, and Arc Testnet chain ID. A receipt cannot be credited
to two tester accounts. Privy sessions sync automatically after app
transactions when the receipt sender belongs to the signed linked-wallet list.
Legacy email sessions still require an account-bound ownership signature.
Pending hashes are retained locally for retry;
a previous transaction hash can also be submitted for server verification.

For existing installations, run `npm run tester:backfill` after the additive
schema sync. This imports only accounts with retained verified email, signed
wallet-session, or authenticated submission evidence and is safe to repeat.

## NFT studio, auctions, and collector rewards

NFT creators can select **Folder / series** in the creator form to upload a
folder or multiple PNG, JPEG, or WebP images: up to 100 images, 5 MB per image,
and 100 MB per selection. Files start in filename order; creators can move or
remove them before submission. The first image is the cover and each image maps
to one ERC-721 token, so supply equals the image count. Uploads are sequential,
completed files survive a failure, and selecting the folder again skips completed
filenames. Filenames must be unique across subfolders. ZIP archives are excluded.
The account upload budget is 200 NFT images and 200 MB per hour.

Reviewers inspect the entire series before approval. Approved collections show
the gallery and expose numbered token metadata. Pending uploads remain private.
Image series use generated metadata and require a new collection deployed through
the updated studio factory; existing deployed contracts cannot be upgraded in
place. ERC-1155 editions continue to share a single image. Back up the local
database, then run `npm run db:generate` and `npm run db:push` after this update.

`/nfts` lists reviewed collections with search, format filters, and price sorting.
`/nfts/create` supports ERC-721 collectibles, ERC-1155 editions (one token ID with
multiple copies), locked ERC-5192 soulbound NFTs, and transferable ERC-721
membership passes. Membership benefits are described by the creator; expiry,
subscriptions, and access enforcement are not automatic. Original Art still
requires human authorship review. AI-generated and assisted NFTs remain allowed.

Applications retain the review step. After approval, the creator can deploy from
the collection detail page and collectors can mint there. Privy email sign-in can
create an embedded wallet. A selected wallet must sign deployments,
mints, payments, and claims. A successful receipt is verified against the approved
settings before the app attaches a collection or art checkout listing.

Creators can configure **Ultimate → FCFS → Public** access in **Mint access** on
an approved, undeployed collection. Set ordered opening dates, tier prices, and
phase wallet limits. Collectors request a tier using a linked, signed-in wallet;
the creator approves requests or imports wallet addresses from text/CSV. Pending
requests do not grant mint access. The roster is private to the creator; a
collector sees only their own assignment and proof.

Ultimate wallets have priority during the first window. Both Ultimate and FCFS
wallets can mint during FCFS, and everyone can mint during public access. Supply
is first come, first served within each window; Ultimate does not reserve supply
or guarantee a mint. Phase limits and the original collection wallet cap both
apply, including across windows. Allowlist prices cannot exceed the approved
public price. Each collection supports up to 2,000 registered/imported wallets.

Before deployment, review the roster and click **Lock allowlist for deployment**.
This permanently closes registration and freezes the schedule, tier prices,
limits, and Merkle root. The factory atomically installs those settings when
creating the collection. Contracts verify wallet/tier proofs and reject public
mint calls during allowlist windows. ERC-721, soulbound, membership, and ERC-1155
collections use the same rules. Public-only collections keep the existing flow.

The previously deployed factory cannot support these new rules. Before replacing
its configured address, run `npm run studio:pin-factories` with the original
factory still in `.env.local`; this records the original factory on existing
collection rows. In `/settings/protocol`, choose **Prepare updated factory and
auction house**. This retains the current art market and deploys a new factory
and auction house from your wallet. Save the displayed configuration, rebuild,
and restart. Existing collections retain their original mint rules. Existing
auctions/reward pools stay on the original house; the new house starts empty and
checks mint eligibility through the new factory. Keep the old addresses for
existing auctions and claims. No deployed collection or live auction is migrated.

The new contracts are restricted to **Arc Testnet** in the app. To activate them:

1. Open `/settings/protocol` and connect a wallet funded with test USDC.
2. Confirm the three contract deployments. Completed steps are saved locally.
3. Copy the public address configuration into `.env.local`, rebuild, and restart.

Alternatively, `npm run studio:deploy:testnet` uses an already configured private
testnet deployer. No private key is required by the browser setup. Re-export
browser bytecode after contract edits with `npm run studio:artifacts`.

`/auctions` supports escrowed ERC-721 auctions with a reserve, deadline, 5% minimum
bid increases, ERC-2981 royalties, pull refunds/proceeds, and a separate winner
NFT claim. Soulbound tokens and ERC-1155 editions cannot use this auction.

Reward rounds are funded independently from auctions. A wallet qualifies after
minting through the configured studio factory or buying art through the
configured art market. The first N eligible wallets to join before the deadline
share the funded pool equally, based on the final participant count. Anyone can
finalize after the deadline; each participant claims once. Rounding dust returns
to the sponsor, or the entire pool if nobody joined. There are no automatic
payments, paid reward entry, random draws, or eligibility inferred from an email
address or an unverified historical database row. Free factory mints also qualify;
one place per wallet does not establish one place per person.

Art checkout collects a delivery address and records a test payment, crediting
the seller for withdrawal. After the server verifies the Arc Testnet purchase,
it stores a private order and marks the artwork sold. The buyer and creator can
view delivery details on the artwork page; public item APIs never include them.
If saving fails after payment, retry with the confirmed transaction hash without
paying again. The first saved address is retained on duplicate submissions.
Agree shipping costs and destinations with the creator before paying. Checkout
does not escrow physical delivery or grant usage rights automatically. Art-market
listing creation is permissionless on-chain; the Artiq UI only attaches receipts
to approved artwork owned by the signed-in creator. Test USDC has no monetary
value. Native USDC amounts use **18 decimals** for all payable calls.

Run `npm test` for the local contracts and `npm run test:app` for application,
authentication, review, metadata, and receipt verification tests.

## Local development

Use Node.js 22.12+ (Node.js 24 LTS is supported).

```sh
npm ci
cp .env.local.example .env.local
npm run db:setup
npm run dev
```

Open http://localhost:3000. `db:setup` generates Prisma Client, creates the
SQLite tables, and seeds demo items. The seed can be rerun without duplicating
demo records. Installation also generates Prisma Client automatically. The project `.npmrc`
uses `legacy-peer-deps` because Privy declares unused optional smart-account peers
that conflict with current viem's `ox`; the React, wagmi, Privy bridge, and viem
versions used by the app are explicitly compatible and locked. The Next webpack
config narrows the connector barrel to the injected entry used by Privy, avoiding
an unused Tempo connector import, and externalizes Privy’s optional Solana adapters.
`@stripe/stripe-js` is installed because Privy’s bundled SDK imports it.

For fast local browsing without per-page development compilation, run
`npm run preview` once, then open http://127.0.0.1:3000. Later, `npm run start:local`
reuses the existing build. Rebuild after source or public environment changes.
This command binds only to loopback and explicitly permits HTTP session cookies
for that local run, including Safari. Normal `npm start` keeps production HTTPS
cookies. Use `npm run dev` when editing and hot reload is needed; stop the other
server before switching modes.

The app and Prisma CLI default to `file:./prisma/dev.db` when `DATABASE_URL`
is absent. Keep `.env.local` private. Blockchain transactions require a wallet,
the correct network configuration, and deployed contract addresses in that file.

To inspect the creator form and image screening without connecting a wallet, run:

```sh
ARTIQ_LOCAL_PREVIEW=true npm run dev -- --hostname 127.0.0.1
```

Open `/apply?type=WEB2_ART`. Preview uploads and applications stay in the browser;
nothing is published. Art preview images use the configured screening service.
NFT previews use metadata checks only. This mode requires a local development
server and loopback host, and cannot be enabled in a production build. For a
temporary public tunnel, explicitly allow only its generated HTTPS origin:

```sh
ARTIQ_LOCAL_PREVIEW=true ARTIQ_PREVIEW_ORIGIN=https://your-tunnel.trycloudflare.com npm run dev -- --hostname 127.0.0.1
```

The remote form and screening endpoint require this exact host and browser
origin. Stop the tunnel to end public access. Stop this run and use the normal
development command to restore wallet sign-in. Actual submission and reviewer
APIs still require a verified account in preview mode.

## Privy sign-in setup

For an existing SQLite installation that predates Privy, back up the database,
then apply this additive upgrade once before the normal schema sync:

```sh
npx prisma db execute --file prisma/upgrades/20261020_privy_auth.sql
npm run db:push
npm run db:generate
```

New databases use the usual `npm run db:setup`. This project uses schema pushes;
the one-time upgrade adds only a nullable user ID, a session table, and indexes.
It avoids rebuilding or deleting existing user records.

The single **Sign in** button uses Privy for email OTP and Ethereum wallets.
Email users without a wallet get an embedded Ethereum wallet. Arc Testnet is the
default and supported chain, with native USDC for gas. Until a real App ID is
configured, the app renders normally and sign-in shows a setup notice.

1. Create an app named **Artiq Testnet** at [Privy Dashboard](https://dashboard.privy.io).
2. Under **User management > Authentication**, enable **Email** and **Ethereum
   wallet** login. Optionally enable **Advanced > Return user data in an identity
   token**. Without that token, the server retrieves verified account links from
   Privy's authenticated current-user API after verifying the access token.
3. In app settings, allow `http://localhost:3000` and your current public HTTPS
   app origin. Temporary Cloudflare tunnel domains change; update the allowed
   origin and Artiq public URL whenever the tunnel changes. If app clients are
   enabled, use the matching public client ID and its allowed origins.
4. Copy the public **App ID** from **Configuration > App settings > Basics** into
   the private `.env.local` file:

   ```dotenv
   NEXT_PUBLIC_PRIVY_APP_ID=your_real_public_app_id
   NEXT_PUBLIC_PRIVY_CLIENT_ID=
   ```

   The client ID is optional. No Privy app secret is needed for this integration:
   the server verifies ES256 tokens using Privy's public JWKS.
5. Restart development, or rebuild and restart production. Test email login,
   external-wallet login, refresh, wallet linking/switching, and sign-out on both
   localhost and the allowed public origin. Fund the selected wallet with Arc
   **testnet** USDC before attempting blockchain transactions.

Privy sends the new sign-in codes. Existing Gmail SMTP configuration remains
private and is retained only for legacy authentication compatibility. Never put
an app secret or private wallet key in a `NEXT_PUBLIC_` variable.

The server verifies the Privy access token and proves linked-account ownership
using either the signed identity token or Privy's authenticated current-user API
before setting a revocable HttpOnly session. No app secret is required. After
Privy sign-in, the navbar shows a profile avatar while this verification finishes;
private pages remain locked until the server verifies the account. If verification
fails, the profile menu and reviewer page offer a retry without repeating email
login. Wallet reconnections do not reset a verified email session.
A matching verified legacy email or wallet preserves the existing account and
its submissions. If both identify different previous accounts, the user chooses
which account to use; histories are not silently merged or deleted. Once linked,
the Privy DID remains the account key. Private requests are bound to the verified
Artiq account ID. Reviewer access requires a verified email listed in the private
`ARTIQ_ADMIN_EMAILS` configuration. A wallet alone never grants reviewer access. Once Privy is
configured, new legacy OTP and wallet-signature logins are disabled; only existing
legacy sessions remain readable for migration until they expire.

See [Privy React setup](https://docs.privy.io/basics/react/setup) and
[identity token setup](https://docs.privy.io/user-management/users/identity-tokens).

## Brand assets

The supplied geometric ARTIC wordmark is shared by navigation, footer, and hero
through `components/ArticLogo.tsx`. Its 21 SVG blocks assemble from a pink center
dot once on mount; reduced-motion preferences show the finished mark immediately.
The full wordmark and dark variant are available in `public/brand`, and
`app/icon.svg` supplies the matching A monogram for browser tabs. Privy uses the
new dark wordmark in its sign-in dialog.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

`npm test` compiles and tests the contracts on the local Hardhat network;
it does not deploy to a public network. The first compile downloads Solidity.
Use `npm start` after a successful build to serve the production build.

## Creator applications

Visit `/apply` and use **Sign in** to continue with email or a wallet through
Privy. A verified Artiq account can submit an NFT collection
or original art for review. Original art requires a
PNG/JPEG/WebP upload (up to 5 MB), a declaration that no generative AI was used,
and at least 30 characters explaining the creation process. NFTs may use uploaded
images or HTTPS image URLs and may declare human-made, AI-assisted, or AI-generated
work. Declared AI use is shown on marketplace NFT cards. Creators can track their
application status. Uploaded images are stored in the database. Pending uploads
can only be viewed by their owner and reviewers; approved listing images are public.
External image URLs retain the visibility of their original host.

Set server-only `ARTIQ_ADMIN_EMAILS` in `.env.local` to a comma-separated list of
approved reviewer emails, then restart the app. Leave it empty to disable access.
Sign in through Privy with an approved email and verify its one-time code. Email
matching ignores letter case and surrounding spaces, but does not treat aliases,
subdomains, or similar addresses as equivalent. Contact fields and client-supplied
email values never grant access. Removing an email revokes access on the next
server request, including private image reads. `ARTIQ_ADMIN_WALLETS` no longer
grants reviewer permissions. Review records identify the reviewer’s stable Artiq
account as `user:<account-id>`; historical wallet audit records stay intact.
Before hosting, set `NEXT_PUBLIC_APP_URL` to the public app origin. A reverse-proxy
deployment can use the server-only `ARTIQ_APP_ORIGIN` override for wallet sign-in.
Visit `/admin/submissions` and sign in with a listed email to approve or reject
applications. Approval posts the listing; it does not deploy a contract or mint an
NFT. Rejections include feedback visible to the creator.

### Legacy email compatibility

The existing Gmail OTP endpoints remain available for migrating earlier accounts
and regression tests. The application UI now uses Privy. Keep any existing
`GMAIL_SMTP_USER`, `GMAIL_SMTP_APP_PASSWORD`, and `ARTIQ_EMAIL_CODE_SECRET` values
server-only; they are not used by Privy's email delivery. Public listings never
expose a creator's private sign-in email.

### Art screening

Uploaded files are checked on the server for known generation declarations in
PNG, JPEG, and WebP metadata. This reads supported metadata containers, not image
pixels. Metadata can be removed or edited; C2PA-like declarations are unverified,
and missing signals do not establish human authorship. Every art application
requires review. Reviewers must inspect the image and creation details, confirm
they have sufficient evidence of human authorship, and write an assessment of at
least 20 characters before publishing. Flags are evidence for review, not automatic
rejection. Older art applications missing this evidence need to be resubmitted.

Optional pixel analysis uses [Sightengine](https://dashboard.sightengine.com/signup).
Create a free account you control, verify its email if requested, and add the
server-only credentials to `.env.local`:

```dotenv
ARTIQ_AI_PIXEL_SCREENING=true
SIGHTENGINE_API_USER=your_api_user
SIGHTENGINE_API_SECRET=your_api_secret
```

Restart the server after changing these settings. Never prefix these credentials
with `NEXT_PUBLIC_` or commit them. Enabling this sends original-art images to
Sightengine when an application is submitted; the form discloses this processing.
NFT applications do not trigger the external pixel model. The `genai` model score
flags possible AI use at 0.8 or above, never certifies an image as human-made, and
can produce false positives and negatives. Missing credentials, disabled screening,
or provider failures retain local checks and mandatory human review. Reports show
whether the pixel service completed, was unavailable, or was not configured.

Pixel screening is disabled by default. Adding this integration does not create
or activate an external service account.

After pulling schema changes, run `npm run db:generate` and `npm run db:push`
against the local development database. Hosting must preserve the database,
including uploaded image data. Never use the local SQLite file on ephemeral hosting.

```sh
node --import tsx --test test/auth/*.test.ts test/submissions/workflow.test.ts test/screening/*.test.ts test/preview/*.test.ts
```

These integration tests use temporary databases and do not change the app's catalog.
