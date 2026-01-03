-- Migration: Shared Contract Model
-- Migrates from per-user AutomationContract to shared contract model
-- No data migration needed (no existing orders in production or development)

-- Step 1: Drop foreign key constraint from automation_close_orders
ALTER TABLE "automation_close_orders" DROP CONSTRAINT IF EXISTS "automation_close_orders_contractId_fkey";

-- Step 2: Drop old indexes
DROP INDEX IF EXISTS "automation_close_orders_contractId_idx";
DROP INDEX IF EXISTS "automation_close_orders_orderType_idx";
DROP INDEX IF EXISTS "automation_close_orders_contractId_status_idx";

-- Step 3: Rename orderType to closeOrderType
ALTER TABLE "automation_close_orders" RENAME COLUMN "orderType" TO "closeOrderType";

-- Step 4: Add automationContractConfig column with default empty JSON
ALTER TABLE "automation_close_orders" ADD COLUMN "automationContractConfig" JSONB NOT NULL DEFAULT '{}';

-- Step 5: Drop contractId column (no longer needed)
ALTER TABLE "automation_close_orders" DROP COLUMN "contractId";

-- Step 6: Drop AutomationContract table (no longer needed)
DROP TABLE IF EXISTS "automation_contracts";

-- Step 7: Create new indexes
CREATE INDEX "automation_close_orders_closeOrderType_idx" ON "automation_close_orders"("closeOrderType");
CREATE INDEX "automation_close_orders_closeOrderType_status_idx" ON "automation_close_orders"("closeOrderType", "status");
