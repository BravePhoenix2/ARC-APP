# Artic

Next.js marketplace with Prisma/SQLite and Solidity contracts.

## Marketplace revenue

NFT collection setup publishes immediately without reviewer approval. Creators
pay a one-time **5 test USDC** fee directly to the existing platform wallet
before creating the on-chain collection, plus network gas. Saving setup and
configuring an allowlist do not charge this fee. Every collection type requires
this payment, including collections with free mints. The server verifies the
confirmed payment and binds it to that creator's collection; one transaction
cannot pay for multiple collections. A confirmed fee remains credited if
collection deployment fails, so retrying never charges it again. Failed payment
transactions do not count as paid. This uses the existing wallet and factory;
no new contract deployment or protocol-address replacement is required.

New studio deployments collect a commission from paid NFT mints, original-art
purchases, and settled asset and NFT auctions. Paid NFT mints have two platform
charges: a fee deducted from creator proceeds and a separate surcharge added to
the price paid by the minter. Under the standard terms, a 5 USDC NFT costs the
minter 5.10 USDC. The 2.5% proceeds fee leaves 4.875 USDC for the creator, while
the platform receives that 0.125 USDC fee plus the 0.10 USDC buyer surcharge,
totaling 0.225 USDC. Gas is separate. Art and auction fees remain included in the
sale price and are deducted from seller proceeds: at 2.5%, a 100 USDC sale credits
2.50 to the platform and 97.50 to the seller before any auction creator royalty.
Creator royalties belong to the creator and are separate from platform revenue.
Free mints, outbid refunds, cancelled/unsold auctions, and reward pools carry no
platform commission.

`/settings/protocol` offers two presets and custom rates up to 10%:

| Preset | Creator mint proceeds | Buyer mint surcharge | Art sales and all auctions |
| --- | --- | --- | --- |
| Standard | 2.5% deducted | 2% added | 2.5% deducted from proceeds |
| OpenSea-style | 10% deducted | 2% added | 1% deducted from proceeds |

The OpenSea-style preset uses rates from the published
[OpenSea fee schedule](https://support.opensea.io/en/articles/8867091-what-fees-do-i-pay-on-opensea),
with its primary mint rate deducted from creator proceeds. Artiq's separate 2%
buyer surcharge still applies.
Choose one preset per deployment. The fee wallet and rates are immutable after
deployment; changing environment defaults does not change deployed terms.
Checkout reads the actual contract terms and shows both mint charges, or the
marketplace deduction, before payment. Verified older contracts retain their
original fee rules.
If fee terms cannot be verified, checkout waits for a successful retry.

Collection creation fees are platform revenue sent straight to the configured
platform wallet. The server uses `FEE_RECIPIENT_ADDRESS`, with
`NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT` as its fallback. These direct payments are
already in that wallet and do not require a contract fee withdrawal.

Mint fees accumulate at the studio factory, art fees at the art market, and auction fees at the auction
house. In `/settings/protocol`, **Platform revenue** shows each configured
contract's cumulative fees and current withdrawable balance. Connect the fee
recipient wallet to withdraw. Creator/seller withdrawals cannot consume platform
fees. Revenue figures come from the chain and exclude royalties, rewards, gas,
and sale proceeds owed to sellers.

The browser setup uses `NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT` to prefill the public
treasury address. The CLI uses `FEE_RECIPIENT_ADDRESS`, `MINT_FEE_BPS`,
`MINT_SURCHARGE_BPS`, and `MARKETPLACE_FEE_BPS` (standard defaults 250/200/250;
use 1000/200/100 for the alternative preset).
No fee wallet private key is required for deployment. Only the recipient can
later sign a fee withdrawal. Browser deployments save their confirmed steps,
pending hash, and frozen terms so retries do not deploy duplicates.

This integration remains restricted to **Arc Testnet**. Test USDC has no monetary
value. Production monetization requires a separate production-chain release and
production deployments; these changes do not activate real-money payments.

For an existing installation, back up the database, then run the additive upgrade
once before changing any existing protocol addresses:

```sh
npx prisma db execute --file prisma/upgrades/20261022_platform_fees.sql
npm run db:generate
npm run db:push
npm run studio:pin-factories
```

The pin command records both original collection factories and original art
markets. Deploy all three fee-enabled contracts in `/settings/protocol`, then
copy the complete configuration, rebuild, and restart. Existing collections and
art listings keep their original contracts and fee terms; only collections
deployed through the updated factory use the buyer-paid mint surcharge. New listings store
their market address when their creation receipt is verified. Old auction houses
are retained in `NEXT_PUBLIC_LEGACY_AUCTION_HOUSE_ADDRESSES` (comma-separated) and
remain selectable on `/auctions` for NFT claims, refunds, seller withdrawals, and
reward claims. No NFT, balance, or live auction is migrated between contracts.

## Digital and physical asset auctions

Open **Auctions** (`/auctions`) to browse or list digital downloads and physical
assets. Signed-in users with a linked wallet can upload a cover photo, describe
what is included, set a starting price, specify delivery terms, and choose a
closing time between two minutes and 30 days away. Physical listings should state
shipping destinations, costs, and delivery times. Digital listings require an
HTTPS download link that stays private until the auction has a settled winner.

Bids use native test USDC and are held by the auction contract. The first bid
must meet the starting price; each later bid must increase the highest bid by
at least 5%. The countdown follows chain time and bids refresh during the
auction. Bids cannot be withdrawn while leading; outbid wallets can withdraw
their entire previous bid. Sellers cannot bid on their own listings or cancel
after the first bid. The contract rejects bids at or after the closing time.

When the timer ends, the highest bidder wins. Anyone can finalize the auction
with **Settle auction**, which makes seller proceeds and the platform commission
withdrawable. A timer does not send a wallet transaction automatically. Listings
with no bids end without a winner or platform fee. For digital and physical
assets, seller payment releases at settlement; delivery is arranged separately
and is not held in physical-delivery escrow. No NFT or proof of physical
ownership is created for these listings.

After settlement, only the winning verified wallet can retrieve a digital
download link or submit a physical delivery address. The seller and winner can
view saved physical delivery details; public listing APIs never return them.
Delivery addresses are saved once so retrying cannot overwrite the original.
Public listing metadata is committed on-chain, and bids are enabled only after
the app verifies that the seller, asset, price, and deadline match that listing.

Creation has two steps: save a private draft, then confirm its creation in the
wallet. The listing appears publicly after the server verifies its receipt.
**Your unpublished auctions** includes unfinished drafts. A saved transaction hash lets the
seller retry publication after a refresh or temporary API failure without
creating another auction. The contract also rejects duplicate creation for the
same seller and asset key. Download links and shipping details are never put in
browser recovery storage.

The original NFT auctions and community rewards remain under **NFT auctions &
community rewards** on the same page. Asset listings keep their original auction
house, including after a later upgrade. Previous houses remain selectable for
older NFT claims, refunds, and rewards.

For an existing installation, back up the database, then run:

```sh

```

This adds the `AssetAuction` table without replacing existing records. Existing
deployed auction houses cannot gain new methods in place. In `/settings/protocol`,
choose **Deploy contracts with asset auctions**, copy the confirmed configuration,
then rebuild and restart. The exported bytecode includes digital/physical support;
the setup verifies this capability before offering configuration to copy. Current
and previous auction-house addresses remain in the generated configuration.
All these payments still use Arc Testnet USDC with no monetary value.

## My NFTs

Open **My NFTs** (`/my-nfts`) from the marketplace navigation or profile menu.
Select the wallet you used to mint to see your Artiq mint history, grouped by
collection, with the total you minted and your current on-chain wallet balance.
This includes ERC-721 collectibles, memberships, soulbound NFTs, and ERC-1155
editions. Transferred mints remain in the history. Use **Refresh NFTs** after a
new mint or transfer. The view covers deployed collections in the Artiq catalog
on Arc Testnet; NFTs from other platforms are not included. Failed collection
reads are shown as an incomplete result with a retry action.

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

Each account earns each milestone once: verified sign-in (10), first published
NFT setup or approved art application (25), collection deployment (20), NFT mint (30), art purchase
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

Saving an NFT setup immediately publishes the gallery and numbered token metadata
without reviewer approval. Uploads stay private until their collection setup is published.
Image series use generated metadata and require a new collection deployed through
the updated studio factory; existing deployed contracts cannot be upgraded in
place. ERC-1155 editions continue to share a single image. Back up the local
database, then run `npm run db:generate` and `npm run db:push` after this update.

`/nfts` lists published collections with search, format filters, and price sorting.
`/nfts/create` supports ERC-721 collectibles, ERC-1155 editions (one token ID with
multiple copies), locked ERC-5192 soulbound NFTs, and transferable ERC-721
membership passes. Membership benefits are described by the creator; expiry,
subscriptions, and access enforcement are not automatic. ART BAZZAR still
requires human authorship review. AI-generated and assisted NFTs remain allowed.

NFTs skip the review queue: saving the creator form opens the collection detail
page, where the creator can configure mint access before paying 5 test USDC to
create the collection. ART BAZZAR retains human review. Collectors can mint after
the on-chain collection exists and its scheduled window opens. Privy email sign-in can
create an embedded wallet. A selected wallet must sign deployments,
mints, payments, and claims. The app first verifies the direct creation-fee
payment, then verifies the collection deployment receipt against the saved
settings before attaching the new collection. Fee and deployment confirmations
can be recovered independently without making a second fee payment.
Original-art checkout listings still require approved artwork.

Creators can configure **Ultimate → FCFS → Public** access in **Mint access** on
a saved, undeployed collection. Set ordered opening dates, tier prices, and
phase wallet limits. The main **Public mint price** from the creator form is used
for Public minting. Ultimate and FCFS have separate prices: after setting up the
phases, use **Edit price** on either tier to save its price independently without
changing the other tier, schedule, or Public price. Edit prices before Ultimate
opens and before the allowlist is locked. Collectors request a tier using a linked, signed-in wallet;
the creator approves requests or imports wallet addresses from text/CSV. Pending
requests do not grant mint access. The roster is private to the creator; a
collector sees only their own assignment and proof.

Each selected Ultimate wallet is guaranteed its full Ultimate allocation during
the Ultimate window. Locking rejects a roster whose Ultimate wallet count times
the Ultimate allocation exceeds collection supply. Public minting is blocked and
FCFS wallets cannot mint during this window, so those allocations remain available.
Unclaimed Ultimate tokens are released when FCFS opens. Both Ultimate and FCFS
wallets can then mint subject to remaining supply; everyone can mint during public
access. Phase limits and the original collection wallet cap both apply, including
across windows. Allowlist prices cannot exceed the collection's
public price. Each collection supports up to 2,000 registered/imported wallets.

Before deployment, review the roster and click **Lock allowlist for deployment**.
This permanently closes registration and freezes the schedule, tier prices,
limits, and Merkle root. The factory atomically installs those settings when
creating the collection. Contracts verify wallet/tier proofs and reject public
mint calls during allowlist windows. ERC-721, soulbound, membership, and ERC-1155
collections use the same rules. Public-only collections keep the existing flow.

The 5 test USDC direct creation payment works with the currently configured
studio factory. Keep the existing protocol addresses when enabling this fee.

Older installations adding mint-phase support for the first time need a
factory that supports those phases. That upgrade is independent of the direct
creation fee. Before replacing original addresses, run
`npm run studio:pin-factories` with the original factory still in `.env.local`;
this records the original factory on existing collection rows and original
art-market addresses on existing checkout listings. Export browser deployment
bytecode with `npm run studio:artifacts`. In `/settings/protocol`, choose
**Deploy contracts with asset auctions** and copy the complete configuration
only after all three transactions confirm, then rebuild and restart. Pending
hashes and confirmed steps are saved in the browser so retries resume safely.
Existing collections retain their original mint rules. Existing auctions and
reward pools stay on the original house; retain its address for existing claims.
No deployed collection or live auction is migrated.

Contract setup is restricted to **Arc Testnet** in the app. For a new installation:

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
The optimized local build lives in `.next-local`, separate from development and
shared preview files. `npm run build:local` builds it without starting a server.
This command binds only to loopback and explicitly permits HTTP session cookies
for that local run, including Safari. Normal `npm start` keeps production HTTPS
cookies. Use `npm run dev` when editing and hot reload is needed; stop the other
server before switching modes.

The landing page renders before the wallet SDK downloads and initializes.
Authenticated watchlist controls load separately, so public discovery does not
pull wallet and private-account code into its initial JavaScript.
Raleway is served with the app through `next/font`, so page rendering does not
wait for an external Google Fonts stylesheet.

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

The landing page's **Launch App** button opens Privy for email OTP and Ethereum
wallet sign-in, then opens the NFT gallery after server verification. Returning
signed-in users enter directly. App pages also require sign-in when opened from
a direct link; the landing page remains public.
Email users without a wallet get an embedded Ethereum wallet. Arc Testnet is the
default and supported chain, with native USDC for gas. Until a real App ID is
configured, the landing page renders normally and app entry shows a setup notice.

1. Create an app named **Artiq Testnet** at [Privy Dashboard](https://dashboard.privy.io).
2. Under **User management > Authentication**, enable **Email** and **Ethereum
   wallet** login. Enable **Advanced > Return user data in an identity token**
   so the server can verify linked accounts without a rate-limited profile request.
   The app accepts the SDK's signed identity token from the request or its cookie,
   including HttpOnly cookies. Without that token, the server falls back to Privy's
   authenticated current-user API, briefly reuses verified profiles, and combines
   concurrent lookups. This fallback still depends on the provider's availability.
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
Privy. A verified Artiq account can publish an NFT collection setup immediately,
or submit ART BAZZAR for review. ART BAZZAR requires a
PNG/JPEG/WebP upload (up to 5 MB), a declaration that no generative AI was used,
and at least 30 characters explaining the creation process. NFTs may use uploaded
images or HTTPS image URLs and may declare human-made, AI-assisted, or AI-generated
work. Declared AI use is shown on marketplace NFT cards. Creators can track their
collection or application status. Uploaded images are stored in the database.
NFT setup images become public when saved; unpublished uploads and pending ART
BAZZAR images remain private to their owner and reviewers. Approved art images are public.
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
art applications. Approval posts the artwork listing; it does not send an on-chain
transaction. New NFT setups do not enter this queue. Historical pending NFT
applications remain unchanged and can be recreated through the current creator
form. Rejections include feedback visible to the creator.

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


## Daily Muse

The NFT gallery and ART BAZZAR include a daily artwork reveal, a short creative
prompt, and a browser-local discovery notebook. Picks rotate at midnight in
Africa/Lagos and come only from published items with images. No login or payment
is required to reveal a work; saving it uses the existing account watchlist.
The public discovery endpoint returns only the artwork and public creator fields.
The notebook remembers up to 366 discovery days in the current browser. Repeated
reveals across the two galleries count as one day. Missing days never remove
previous pages. Browser storage can be cleared, and no notebook data is sent to
the server or used for tester points, mint access, or financial rewards.
