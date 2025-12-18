-- Migration: Embed manifest in Strategy model
--
-- This migration transitions from a separate StrategyManifest table
-- to embedding the manifest directly in the Strategy model.
--
-- Changes:
-- 1. Add 'manifest' JSON field to strategies table
-- 2. Migrate existing manifest data to embedded field
-- 3. Remove manifestId foreign key
-- 4. Drop strategy_manifests table

-- Step 1: Add manifest JSON field to strategies table
ALTER TABLE "strategies" ADD COLUMN "manifest" JSONB;

-- Step 2: Migrate existing manifest data to embedded field
-- Copy full manifest data from strategy_manifests to strategies.manifest
UPDATE "strategies" s
SET "manifest" = (
  SELECT jsonb_build_object(
    'name', sm."name",
    'version', sm."version",
    'description', sm."description",
    'author', sm."author",
    'abi', sm."abi",
    'bytecode', sm."bytecode",
    'constructorParams', sm."constructorParams",
    'tags', sm."tags"
  )
  FROM "strategy_manifests" sm
  WHERE sm."id" = s."manifestId"
)
WHERE s."manifestId" IS NOT NULL;

-- Step 3: Drop the foreign key constraint
ALTER TABLE "strategies" DROP CONSTRAINT IF EXISTS "strategies_manifestId_fkey";

-- Step 4: Drop the manifestId column
ALTER TABLE "strategies" DROP COLUMN "manifestId";

-- Step 5: Drop indexes on strategy_manifests
DROP INDEX IF EXISTS "strategy_manifests_basicCurrencyId_idx";
DROP INDEX IF EXISTS "strategy_manifests_isActive_idx";

-- Step 6: Drop the strategy_manifests table
DROP TABLE IF EXISTS "strategy_manifests";
