-- AlterTable: Add ownerWallet column (nullable for migration)
ALTER TABLE "public"."positions" ADD COLUMN "ownerWallet" TEXT;

-- Drop old unique constraint
DROP INDEX IF EXISTS "public"."positions_userId_positionHash_key";

-- Create new unique constraint including ownerWallet
CREATE UNIQUE INDEX "positions_userId_positionHash_ownerWallet_key" ON "public"."positions"("userId", "positionHash", "ownerWallet");

-- Index for ownerWallet lookups
CREATE INDEX "positions_ownerWallet_idx" ON "public"."positions"("ownerWallet");
