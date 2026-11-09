CREATE TABLE "CollectionCreationPayment" (
    "itemId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "payerWallet" TEXT NOT NULL,
    "recipientWallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "amount" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionCreationPayment_pkey" PRIMARY KEY ("itemId")
);
CREATE UNIQUE INDEX "CollectionCreationPayment_txHash_key" ON "CollectionCreationPayment"("txHash");
ALTER TABLE "CollectionCreationPayment" ADD CONSTRAINT "CollectionCreationPayment_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial records are accessible only through the authenticated server API.
ALTER TABLE "CollectionCreationPayment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE "CollectionCreationPayment" FROM PUBLIC;
DO $creation_payment_server_only$
DECLARE browser_role text;
BEGIN
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE "CollectionCreationPayment" FROM %I', browser_role);
        END IF;
    END LOOP;
END
$creation_payment_server_only$;
