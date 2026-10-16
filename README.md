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
