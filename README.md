# Artic

Next.js marketplace with Prisma/SQLite and Solidity contracts.

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
demo records. Installation also generates Prisma Client automatically.

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
APIs still require wallet authentication in preview mode.

## Wallet connections

Connect Wallet opens a picker for installed browser wallets, including MetaMask,
Rabby, Coinbase Wallet, Trust Wallet, and Phantom. Wallets that announce themselves
through EIP-6963 are discovered automatically, with a generic browser-wallet
fallback for older extensions. Each choice uses that wallet's own provider.
The picker offers installation links for missing wallets. On mobile, open Artiq
in the wallet's built-in browser. WalletConnect QR connections are not enabled.

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

Visit `/apply` to sign in with a one-time email code or connect a wallet and sign
a free ownership-verification message. Either account can submit an NFT collection
or original art for review. Original art requires a
PNG/JPEG/WebP upload (up to 5 MB), a declaration that no generative AI was used,
and at least 30 characters explaining the creation process. NFTs may use uploaded
images or HTTPS image URLs and may declare human-made, AI-assisted, or AI-generated
work. Declared AI use is shown on marketplace NFT cards. Creators can track their
application status. Uploaded images are stored in the database. Pending uploads
can only be viewed by their owner and reviewers; approved listing images are public.
External image URLs retain the visibility of their original host.

Set `ARTIQ_ADMIN_WALLETS` in `.env.local` to a comma-separated list of reviewer
wallet addresses, then restart the app. Leave it empty to disable reviewer access.
Before hosting, set `NEXT_PUBLIC_APP_URL` to the public app origin. A reverse-proxy
deployment can use the server-only `ARTIQ_APP_ORIGIN` override for wallet sign-in.
Visit `/admin/submissions` and sign in with a listed wallet to approve or reject
applications. Approval posts the listing; it does not deploy a contract or mint an
NFT. Rejections include feedback visible to the creator.

### Email sign-in

The Email option creates an account after a six-digit code is verified. Configure
Gmail SMTP in the private server environment:

```dotenv
GMAIL_SMTP_USER=you@gmail.com
GMAIL_SMTP_APP_PASSWORD=your_google_app_password
ARTIQ_EMAIL_CODE_SECRET=at_least_32_random_characters
```

Enable Google 2-Step Verification, then create an app password at
<https://myaccount.google.com/apppasswords>. Never use your normal Gmail password,
prefix these secrets with `NEXT_PUBLIC_`, or commit them. Restart the server after
changing the environment. Codes expire after ten minutes and have five attempts.
Code hashes and session-token hashes are stored in the database; plaintext codes
are sent only by email. Resends and total sends are limited to protect delivery.
Without configured Gmail credentials, the UI explains that email sign-in is being
set up and wallet sign-in stays available. There is no preview-code fallback.

Email sign-in proves mailbox access and does not create a blockchain wallet.
Wallet and email accounts remain separate; emails are never automatically linked
to a wallet or granted reviewer access. Email users' uploads and application
history are private to their account and reviewers. Public listings show the
creator's chosen name, never their private account email. Blockchain transactions
still require a connected wallet. Reviewer access remains wallet based.

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
