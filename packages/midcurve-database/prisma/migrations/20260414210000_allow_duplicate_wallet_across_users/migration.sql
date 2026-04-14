-- Allow the same wallet to be registered by multiple users.
-- Keep the composite unique (userId, walletHash) to prevent same-user duplicates.

-- Drop the global unique constraint on walletHash
DROP INDEX IF EXISTS "public"."user_wallets_walletHash_key";

-- Add a non-unique index for lookups by walletHash
CREATE INDEX "user_wallets_walletHash_idx" ON "public"."user_wallets"("walletHash");
