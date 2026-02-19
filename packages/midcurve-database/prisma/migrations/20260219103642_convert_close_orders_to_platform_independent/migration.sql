-- ConvertCloseOrdersToPlatformIndependent
--
-- Refactors OnChainCloseOrder and CloseOrderExecution to follow the Position model's
-- platform-independent pattern: protocol discriminator + JSON config/state columns.
-- All UniswapV3-specific scalar columns are migrated into JSON, then dropped.

-- =============================================================================
-- STEP 1: Add new columns (nullable initially for backfill)
-- =============================================================================

-- OnChainCloseOrder: add protocol, orderIdentityHash, config, state
ALTER TABLE "on_chain_close_orders" ADD COLUMN "protocol" TEXT;
ALTER TABLE "on_chain_close_orders" ADD COLUMN "orderIdentityHash" TEXT;
ALTER TABLE "on_chain_close_orders" ADD COLUMN "config" JSONB;
ALTER TABLE "on_chain_close_orders" ADD COLUMN "state" JSONB;

-- CloseOrderExecution: add protocol, config, state
ALTER TABLE "close_order_executions" ADD COLUMN "protocol" TEXT;
ALTER TABLE "close_order_executions" ADD COLUMN "config" JSONB;
ALTER TABLE "close_order_executions" ADD COLUMN "state" JSONB;

-- =============================================================================
-- STEP 2: Backfill OnChainCloseOrder data from existing columns
-- =============================================================================

UPDATE "on_chain_close_orders" SET
  "protocol" = 'uniswapv3',
  "orderIdentityHash" = 'uniswapv3/' || "chainId"::TEXT || '/' || "nftId" || '/' || "triggerMode"::TEXT,
  "config" = jsonb_build_object(
    'chainId', "chainId",
    'nftId', "nftId",
    'triggerMode', "triggerMode",
    'contractAddress', "contractAddress"
  ),
  "state" = jsonb_build_object(
    'triggerTick', "triggerTick",
    'slippageBps', "slippageBps",
    'payoutAddress', "payoutAddress",
    'operatorAddress', "operatorAddress",
    'owner', "owner",
    'pool', "pool",
    'validUntil', CASE WHEN "validUntil" IS NOT NULL THEN to_char("validUntil" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
    'swapDirection', "swapDirection",
    'swapSlippageBps', "swapSlippageBps",
    'registrationTxHash', "registrationTxHash",
    'registeredAt', CASE WHEN "registeredAt" IS NOT NULL THEN to_char("registeredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE NULL END,
    'lastSyncBlock', "lastSyncBlock"
  );

-- =============================================================================
-- STEP 3: Backfill CloseOrderExecution data from existing columns
-- =============================================================================

UPDATE "close_order_executions" SET
  "protocol" = 'uniswapv3',
  "config" = jsonb_build_object(
    'triggerSqrtPriceX96', "triggerSqrtPriceX96"
  ),
  "state" = jsonb_build_object(
    'txHash', "txHash",
    'executionSqrtPriceX96', "executionSqrtPriceX96",
    'executionFeeBps', "executionFeeBps",
    'amount0Out', "amount0Out",
    'amount1Out', "amount1Out",
    'swapExecution', "swapExecution"
  );

-- =============================================================================
-- STEP 4: Make new columns NOT NULL
-- =============================================================================

ALTER TABLE "on_chain_close_orders" ALTER COLUMN "protocol" SET NOT NULL;
ALTER TABLE "on_chain_close_orders" ALTER COLUMN "orderIdentityHash" SET NOT NULL;
ALTER TABLE "on_chain_close_orders" ALTER COLUMN "config" SET NOT NULL;
ALTER TABLE "on_chain_close_orders" ALTER COLUMN "state" SET NOT NULL;

ALTER TABLE "close_order_executions" ALTER COLUMN "protocol" SET NOT NULL;
ALTER TABLE "close_order_executions" ALTER COLUMN "config" SET NOT NULL;
ALTER TABLE "close_order_executions" ALTER COLUMN "state" SET NOT NULL;

-- =============================================================================
-- STEP 5: Add new unique constraints and indexes
-- =============================================================================

CREATE UNIQUE INDEX "on_chain_close_orders_orderIdentityHash_key" ON "on_chain_close_orders"("orderIdentityHash");
CREATE UNIQUE INDEX "on_chain_close_orders_positionId_closeOrderHash_key" ON "on_chain_close_orders"("positionId", "closeOrderHash");
CREATE INDEX "on_chain_close_orders_protocol_idx" ON "on_chain_close_orders"("protocol");

-- =============================================================================
-- STEP 6: Drop old unique constraints
-- =============================================================================

DROP INDEX IF EXISTS "on_chain_close_orders_positionId_triggerMode_key";
DROP INDEX IF EXISTS "on_chain_close_orders_chainId_nftId_triggerMode_key";

-- =============================================================================
-- STEP 7: Drop old indexes on columns being removed
-- =============================================================================

DROP INDEX IF EXISTS "on_chain_close_orders_chainId_contractAddress_idx";
DROP INDEX IF EXISTS "on_chain_close_orders_pool_idx";

-- =============================================================================
-- STEP 8: Drop old columns from OnChainCloseOrder
-- =============================================================================

ALTER TABLE "on_chain_close_orders" DROP COLUMN "chainId";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "nftId";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "triggerMode";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "contractAddress";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "triggerTick";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "slippageBps";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "payoutAddress";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "operatorAddress";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "owner";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "pool";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "validUntil";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "swapDirection";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "swapSlippageBps";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "registrationTxHash";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "registeredAt";
ALTER TABLE "on_chain_close_orders" DROP COLUMN "lastSyncBlock";

-- =============================================================================
-- STEP 9: Drop old columns from CloseOrderExecution
-- =============================================================================

ALTER TABLE "close_order_executions" DROP COLUMN "triggerSqrtPriceX96";
ALTER TABLE "close_order_executions" DROP COLUMN "txHash";
ALTER TABLE "close_order_executions" DROP COLUMN "executionSqrtPriceX96";
ALTER TABLE "close_order_executions" DROP COLUMN "executionFeeBps";
ALTER TABLE "close_order_executions" DROP COLUMN "amount0Out";
ALTER TABLE "close_order_executions" DROP COLUMN "amount1Out";
ALTER TABLE "close_order_executions" DROP COLUMN "swapExecution";
