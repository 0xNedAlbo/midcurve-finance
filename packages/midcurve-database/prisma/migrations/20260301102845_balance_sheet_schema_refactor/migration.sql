-- AlterTable
ALTER TABLE "accounting"."nav_snapshots" ALTER COLUMN "depositedLiquidityAtCost" DROP DEFAULT,
ALTER COLUMN "markToMarketAdjustment" DROP DEFAULT,
ALTER COLUMN "unclaimedFees" DROP DEFAULT,
ALTER COLUMN "contributedCapital" DROP DEFAULT,
ALTER COLUMN "capitalReturned" DROP DEFAULT,
ALTER COLUMN "retainedRealizedWithdrawals" DROP DEFAULT,
ALTER COLUMN "retainedRealizedFees" DROP DEFAULT,
ALTER COLUMN "retainedUnrealizedPrice" DROP DEFAULT,
ALTER COLUMN "retainedUnrealizedFees" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accounting"."tracked_positions" RENAME CONSTRAINT "tracked_instruments_pkey" TO "tracked_positions_pkey";

-- RenameForeignKey
ALTER TABLE "accounting"."tracked_positions" RENAME CONSTRAINT "tracked_instruments_userId_fkey" TO "tracked_positions_userId_fkey";

-- RenameIndex
ALTER INDEX "accounting"."tracked_instruments_userId_idx" RENAME TO "tracked_positions_userId_idx";

-- RenameIndex
ALTER INDEX "accounting"."tracked_instruments_userId_instrumentRef_key" RENAME TO "tracked_positions_userId_positionRef_key";
