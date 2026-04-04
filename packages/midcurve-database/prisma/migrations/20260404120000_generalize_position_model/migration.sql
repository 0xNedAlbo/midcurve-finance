-- Generalize position model: rename fee fields to yield, add type discriminator, add APR breakdown

-- Position: rename fields
ALTER TABLE "public"."positions" RENAME COLUMN "currentCostBasis" TO "costBasis";
ALTER TABLE "public"."positions" RENAME COLUMN "collectedFees" TO "collectedYield";
ALTER TABLE "public"."positions" RENAME COLUMN "unClaimedFees" TO "unclaimedYield";
ALTER TABLE "public"."positions" RENAME COLUMN "lastFeesCollectedAt" TO "lastYieldClaimedAt";

-- Position: add type discriminator (backfill existing rows as LP_CONCENTRATED)
ALTER TABLE "public"."positions" ADD COLUMN "type" TEXT;
UPDATE "public"."positions" SET "type" = 'LP_CONCENTRATED';
ALTER TABLE "public"."positions" ALTER COLUMN "type" SET NOT NULL;

-- Position: add APR breakdown fields
ALTER TABLE "public"."positions" ADD COLUMN "baseApr" DOUBLE PRECISION;
ALTER TABLE "public"."positions" ADD COLUMN "rewardApr" DOUBLE PRECISION;

-- Position: backfill baseApr from totalApr for existing rows
UPDATE "public"."positions" SET "baseApr" = "totalApr", "rewardApr" = 0 WHERE "totalApr" IS NOT NULL;

-- Position: add index on type
CREATE INDEX "positions_type_idx" ON "public"."positions"("type");

-- PositionLedgerEvent: rename fields
ALTER TABLE "public"."position_ledger_events" RENAME COLUMN "deltaCollectedFees" TO "deltaCollectedYield";
ALTER TABLE "public"."position_ledger_events" RENAME COLUMN "collectedFeesAfter" TO "collectedYieldAfter";

-- PositionAprPeriod: rename field
ALTER TABLE "public"."position_apr_periods" RENAME COLUMN "collectedFeeValue" TO "collectedYieldValue";
