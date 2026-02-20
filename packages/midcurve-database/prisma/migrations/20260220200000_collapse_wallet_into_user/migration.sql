-- Collapse auth_wallet_addresses into users table
-- Step 1: Add nullable address column to users
ALTER TABLE "users" ADD COLUMN "address" TEXT;

-- Step 2: Copy primary wallet address to users
UPDATE "users" SET "address" = (
  SELECT "address" FROM "auth_wallet_addresses"
  WHERE "auth_wallet_addresses"."userId" = "users"."id"
    AND "auth_wallet_addresses"."isPrimary" = true
  LIMIT 1
);

-- Step 3: Fallback — copy any wallet for users that had no primary
UPDATE "users" SET "address" = (
  SELECT "address" FROM "auth_wallet_addresses"
  WHERE "auth_wallet_addresses"."userId" = "users"."id"
  ORDER BY "createdAt" ASC
  LIMIT 1
) WHERE "address" IS NULL;

-- Step 4: Delete orphaned users with no wallet address
DELETE FROM "users" WHERE "address" IS NULL;

-- Step 5: Make address NOT NULL and add unique constraint
ALTER TABLE "users" ALTER COLUMN "address" SET NOT NULL;
CREATE UNIQUE INDEX "users_address_key" ON "users"("address");

-- Step 6: Drop auth_wallet_addresses table
DROP TABLE "auth_wallet_addresses";
