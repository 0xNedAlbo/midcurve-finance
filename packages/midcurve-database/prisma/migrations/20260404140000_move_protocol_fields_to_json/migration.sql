-- Move protocol-specific fields from dedicated columns into JSON config/state/data columns

-- Position: drop isToken0Quote, priceRangeLower, priceRangeUpper (now in config JSON)
ALTER TABLE "public"."positions" DROP COLUMN "isToken0Quote";
ALTER TABLE "public"."positions" DROP COLUMN "priceRangeLower";
ALTER TABLE "public"."positions" DROP COLUMN "priceRangeUpper";

-- PositionLedgerEvent: drop poolPrice, token0Amount, token1Amount (now in state JSON)
ALTER TABLE "public"."position_ledger_events" DROP COLUMN "poolPrice";
ALTER TABLE "public"."position_ledger_events" DROP COLUMN "token0Amount";
ALTER TABLE "public"."position_ledger_events" DROP COLUMN "token1Amount";

-- PositionRangeStatus: replace lastSqrtPriceX96, lastTick with data JSON
ALTER TABLE "public"."position_range_statuses" ADD COLUMN "data" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "public"."position_range_statuses" DROP COLUMN "lastSqrtPriceX96";
ALTER TABLE "public"."position_range_statuses" DROP COLUMN "lastTick";
