-- AlterEnum: Add new values to StrategyStatus
-- Migration aligns DB status enum with on-chain LifecycleMixin states

-- Step 1: Add new enum values
ALTER TYPE "StrategyStatus" ADD VALUE IF NOT EXISTS 'deploying' AFTER 'pending';
ALTER TYPE "StrategyStatus" ADD VALUE IF NOT EXISTS 'deployed' AFTER 'deploying';
ALTER TYPE "StrategyStatus" ADD VALUE IF NOT EXISTS 'starting' AFTER 'deployed';
ALTER TYPE "StrategyStatus" ADD VALUE IF NOT EXISTS 'shutting_down' AFTER 'active';

-- Step 2: Migrate existing 'paused' records to 'active' (paused was a UI-only concept)
-- Note: This must run after the enum values are added
UPDATE "strategies" SET status = 'active' WHERE status = 'paused';

-- Step 3: Remove 'paused' value from enum
-- PostgreSQL doesn't support dropping enum values directly, so we need to recreate the enum
-- This is safe because we migrated all 'paused' records above

-- Create new enum without 'paused'
CREATE TYPE "StrategyStatus_new" AS ENUM ('pending', 'deploying', 'deployed', 'starting', 'active', 'shutting_down', 'shutdown');

-- Update the column to use the new enum
ALTER TABLE "strategies" ALTER COLUMN "status" TYPE "StrategyStatus_new" USING ("status"::text::"StrategyStatus_new");

-- Drop old enum and rename new one
DROP TYPE "StrategyStatus";
ALTER TYPE "StrategyStatus_new" RENAME TO "StrategyStatus";
