-- Delete existing NAV snapshots (dev data only) to allow adding NOT NULL journalHash column.
-- New snapshots with proper journalHash + SnapshotStateCache are generated on next daily cron run.
DELETE FROM "accounting"."nav_snapshots";

-- AlterTable
ALTER TABLE "accounting"."nav_snapshots" ADD COLUMN     "journalHash" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "accounting"."snapshot_state_cache" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "midnightBlock" TEXT NOT NULL,
    "positionStates" JSONB NOT NULL,
    "quoteTokenPrices" JSONB NOT NULL,

    CONSTRAINT "snapshot_state_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snapshot_state_cache_snapshotId_idx" ON "accounting"."snapshot_state_cache"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "snapshot_state_cache_snapshotId_chainId_key" ON "accounting"."snapshot_state_cache"("snapshotId", "chainId");

-- CreateIndex
CREATE INDEX "nav_snapshots_userId_journalHash_idx" ON "accounting"."nav_snapshots"("userId", "journalHash");

-- AddForeignKey
ALTER TABLE "accounting"."snapshot_state_cache" ADD CONSTRAINT "snapshot_state_cache_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "accounting"."nav_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
