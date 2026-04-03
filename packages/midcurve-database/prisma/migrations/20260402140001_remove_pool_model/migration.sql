-- Remove poolId foreign key and column from positions
ALTER TABLE "positions" DROP CONSTRAINT IF EXISTS "positions_poolId_fkey";
DROP INDEX IF EXISTS "positions_poolId_idx";
ALTER TABLE "positions" DROP COLUMN IF EXISTS "poolId";

-- Drop the pools table
DROP TABLE IF EXISTS "pools";
