-- Remove unused columns from strategy_manifests table
-- These fields are being removed as they are not currently used
-- and will be replaced with a different system in the future

-- AlterTable
ALTER TABLE "strategy_manifests" DROP COLUMN "capabilities",
DROP COLUMN "userParams";
