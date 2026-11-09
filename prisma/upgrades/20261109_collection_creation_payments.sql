-- Additive SQLite upgrade. Existing users, items, balances and sessions remain intact.
CREATE TABLE IF NOT EXISTS "CollectionCreationPayment" (
    "itemId" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "payerWallet" TEXT NOT NULL,
    "recipientWallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "paidAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionCreationPayment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CollectionCreationPayment_txHash_key" ON "CollectionCreationPayment"("txHash");
