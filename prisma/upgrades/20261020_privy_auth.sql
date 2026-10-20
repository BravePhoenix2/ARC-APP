-- Additive SQLite change for an existing Artiq database.
-- Existing users receive NULL privyId; SQLite permits multiple NULLs in a unique index.
-- Apply once. No existing table or row is rebuilt, replaced, or removed.
BEGIN TRANSACTION;

ALTER TABLE "User" ADD COLUMN "privyId" TEXT;

CREATE UNIQUE INDEX "User_privyId_key" ON "User"("privyId");

CREATE TABLE "PrivySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "privyDid" TEXT NOT NULL,
    "verifiedEmail" TEXT,
    "walletAddresses" JSONB NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrivySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PrivySession_tokenHash_key" ON "PrivySession"("tokenHash");
CREATE INDEX "PrivySession_expiresAt_idx" ON "PrivySession"("expiresAt");
CREATE INDEX "PrivySession_userId_idx" ON "PrivySession"("userId");

COMMIT;
