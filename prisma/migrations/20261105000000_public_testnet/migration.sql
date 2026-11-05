-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('NFT', 'WEB2_ART');

-- CreateEnum
CREATE TYPE "NftKind" AS ENUM ('COLLECTIBLE', 'EDITION', 'SOULBOUND', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('UPCOMING', 'LIVE', 'MINTED_OUT', 'LISTED');

-- CreateEnum
CREATE TYPE "ArtCategory" AS ENUM ('PAINTING', 'RUG', 'COSMETIC', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('MINT', 'SALE', 'LISTING', 'DELIST', 'PRICE_UPDATE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CreationMethod" AS ENUM ('UNKNOWN', 'HUMAN', 'AI_GENERATED', 'AI_ASSISTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "privyId" TEXT,
    "walletAddress" TEXT,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "username" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "isCreator" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetAuction" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "deliveryTerms" TEXT NOT NULL,
    "reservePrice" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "assetKey" TEXT NOT NULL,
    "marketAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 5042002,
    "auctionId" TEXT,
    "activationTxHash" TEXT,
    "digitalDeliveryUrl" TEXT,
    "delivery" JSONB,
    "winnerWallet" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetAuction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TesterProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterMilestone" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chainId" INTEGER,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TesterMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creationMethod" "CreationMethod" NOT NULL DEFAULT 'UNKNOWN',
    "creatorId" TEXT NOT NULL,
    "nftKind" "NftKind",
    "symbol" TEXT,
    "metadataUri" TEXT,
    "maxPerWallet" INTEGER,
    "royaltyBps" INTEGER,
    "attributes" JSONB,
    "imageCount" INTEGER NOT NULL DEFAULT 1,
    "contractAddress" TEXT,
    "deploymentFactory" TEXT,
    "mintPriceUsdc" DOUBLE PRECISION,
    "mintStartTime" TIMESTAMP(3),
    "maxSupply" INTEGER,
    "mintedCount" INTEGER DEFAULT 0,
    "rarities" JSONB,
    "status" "ItemStatus",
    "category" "ArtCategory",
    "priceUsdc" DOUBLE PRECISION,
    "quantityAvailable" INTEGER,
    "sold" BOOLEAN NOT NULL DEFAULT false,
    "artListingId" TEXT,
    "artListingSeller" TEXT,
    "artMarketAddress" TEXT,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtOrder" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "buyerWallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "marketAddress" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "delivery" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "priceUsdc" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "itemId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "priceUsdc" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "itemType" "ItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "priceUsdc" DOUBLE PRECISION NOT NULL,
    "category" "ArtCategory",
    "nftKind" "NftKind",
    "symbol" TEXT,
    "metadataUri" TEXT,
    "maxPerWallet" INTEGER,
    "royaltyBps" INTEGER,
    "attributes" JSONB,
    "imageCount" INTEGER NOT NULL DEFAULT 1,
    "contractAddress" TEXT,
    "maxSupply" INTEGER,
    "mintStartTime" TIMESTAMP(3),
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creationMethod" "CreationMethod" NOT NULL DEFAULT 'UNKNOWN',
    "humanMadeDeclaration" BOOLEAN NOT NULL DEFAULT false,
    "creationProcess" TEXT,
    "screening" JSONB,
    "artReviewConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionImage" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "submissionId" TEXT,
    "itemId" TEXT,

    CONSTRAINT "CollectionImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletChallenge" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedImage" (
    "id" TEXT NOT NULL,
    "ownerWallet" TEXT,
    "ownerUserId" TEXT,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "storageKey" TEXT,
    "byteSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screening" JSONB,

    CONSTRAINT "UploadedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailChallenge" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivySession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "privyDid" TEXT NOT NULL,
    "verifiedEmail" TEXT,
    "walletAddresses" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintAccessPlan" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "root" TEXT,
    "frozenAt" TIMESTAMP(3),

    CONSTRAINT "MintAccessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintAllowlistEntry" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "requestedTier" TEXT NOT NULL DEFAULT 'FCFS',
    "tier" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MintAllowlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privyId_key" ON "User"("privyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AssetAuction_assetKey_key" ON "AssetAuction"("assetKey");

-- CreateIndex
CREATE INDEX "AssetAuction_sellerId_createdAt_idx" ON "AssetAuction"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetAuction_kind_createdAt_id_idx" ON "AssetAuction"("kind", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AssetAuction_createdAt_id_idx" ON "AssetAuction"("createdAt", "id");

-- CreateIndex
CREATE INDEX "AssetAuction_imageUrl_idx" ON "AssetAuction"("imageUrl");

-- CreateIndex
CREATE UNIQUE INDEX "AssetAuction_chainId_marketAddress_auctionId_key" ON "AssetAuction"("chainId", "marketAddress", "auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "TesterProfile_userId_key" ON "TesterProfile"("userId");

-- CreateIndex
CREATE INDEX "TesterProfile_lastActiveAt_idx" ON "TesterProfile"("lastActiveAt");

-- CreateIndex
CREATE INDEX "TesterMilestone_kind_idx" ON "TesterMilestone"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "TesterMilestone_profileId_kind_key" ON "TesterMilestone"("profileId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TesterMilestone_chainId_txHash_key" ON "TesterMilestone"("chainId", "txHash");

-- CreateIndex
CREATE INDEX "Item_createdAt_id_idx" ON "Item"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Item_itemType_createdAt_id_idx" ON "Item"("itemType", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Item_creatorId_createdAt_id_idx" ON "Item"("creatorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Item_itemType_idx" ON "Item"("itemType");

-- CreateIndex
CREATE INDEX "Item_nftKind_idx" ON "Item"("nftKind");

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "WatchlistEntry_userId_createdAt_idx" ON "WatchlistEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_userId_itemId_key" ON "WatchlistEntry"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtOrder_itemId_key" ON "ArtOrder"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtOrder_txHash_key" ON "ArtOrder"("txHash");

-- CreateIndex
CREATE INDEX "ArtOrder_buyerId_createdAt_idx" ON "ArtOrder"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_itemId_idx" ON "Listing"("itemId");

-- CreateIndex
CREATE INDEX "Listing_active_idx" ON "Listing"("active");

-- CreateIndex
CREATE INDEX "Activity_itemId_idx" ON "Activity"("itemId");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_itemId_key" ON "Submission"("itemId");

-- CreateIndex
CREATE INDEX "Submission_creatorId_createdAt_idx" ON "Submission"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_status_createdAt_idx" ON "Submission"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CollectionImage_imageUrl_idx" ON "CollectionImage"("imageUrl");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionImage_submissionId_position_key" ON "CollectionImage"("submissionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionImage_itemId_position_key" ON "CollectionImage"("itemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WalletChallenge_nonce_key" ON "WalletChallenge"("nonce");

-- CreateIndex
CREATE INDEX "WalletChallenge_walletAddress_expiresAt_idx" ON "WalletChallenge"("walletAddress", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSession_tokenHash_key" ON "WalletSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WalletSession_expiresAt_idx" ON "WalletSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UploadedImage_ownerUserId_createdAt_idx" ON "UploadedImage"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailChallenge_email_createdAt_idx" ON "EmailChallenge"("email", "createdAt");

-- CreateIndex
CREATE INDEX "EmailChallenge_createdAt_idx" ON "EmailChallenge"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSession_tokenHash_key" ON "EmailSession"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailSession_expiresAt_idx" ON "EmailSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivySession_tokenHash_key" ON "PrivySession"("tokenHash");

-- CreateIndex
CREATE INDEX "PrivySession_expiresAt_idx" ON "PrivySession"("expiresAt");

-- CreateIndex
CREATE INDEX "PrivySession_userId_idx" ON "PrivySession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MintAccessPlan_itemId_key" ON "MintAccessPlan"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "MintAllowlistEntry_planId_walletAddress_key" ON "MintAllowlistEntry"("planId", "walletAddress");

-- AddForeignKey
ALTER TABLE "AssetAuction" ADD CONSTRAINT "AssetAuction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterProfile" ADD CONSTRAINT "TesterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterMilestone" ADD CONSTRAINT "TesterMilestone_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TesterProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtOrder" ADD CONSTRAINT "ArtOrder_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtOrder" ADD CONSTRAINT "ArtOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionImage" ADD CONSTRAINT "CollectionImage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionImage" ADD CONSTRAINT "CollectionImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedImage" ADD CONSTRAINT "UploadedImage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSession" ADD CONSTRAINT "EmailSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivySession" ADD CONSTRAINT "PrivySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintAccessPlan" ADD CONSTRAINT "MintAccessPlan_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintAllowlistEntry" ADD CONSTRAINT "MintAllowlistEntry_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MintAccessPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

