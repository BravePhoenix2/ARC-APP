-- Existing installations only, once, before the normal schema sync.
-- This additive column preserves original art-market references across upgrades.
ALTER TABLE "Item" ADD COLUMN "artMarketAddress" TEXT;
