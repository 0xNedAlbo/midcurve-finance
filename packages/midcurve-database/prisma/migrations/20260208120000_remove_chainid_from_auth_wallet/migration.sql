-- Remove chainId from AuthWalletAddress
-- The same EVM private key controls an address on ALL chains,
-- so chainId should not be part of user identity.

-- Step 1: Remove duplicate wallet entries (same address, different chainIds).
-- Keep the oldest entry per address (earliest createdAt).
DELETE FROM "auth_wallet_addresses"
WHERE id NOT IN (
  SELECT DISTINCT ON (address) id
  FROM "auth_wallet_addresses"
  ORDER BY address, "createdAt" ASC
);

-- Step 2: Drop the old composite unique index
DROP INDEX IF EXISTS "auth_wallet_addresses_address_chainId_key";

-- Step 3: Drop the address index (will be replaced by unique constraint)
DROP INDEX IF EXISTS "auth_wallet_addresses_address_idx";

-- Step 4: Remove the chainId column
ALTER TABLE "auth_wallet_addresses" DROP COLUMN "chainId";

-- Step 5: Add new unique constraint on address alone
CREATE UNIQUE INDEX "auth_wallet_addresses_address_key" ON "auth_wallet_addresses"("address");
