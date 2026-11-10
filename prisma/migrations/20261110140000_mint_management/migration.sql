-- Closing a mint does not imply that every token was minted.
ALTER TYPE "ItemStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
