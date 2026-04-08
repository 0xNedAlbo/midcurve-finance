-- Remove TrackedPosition system (automatic accounting for all user positions)

-- Drop FK constraint and index from journal_entries
ALTER TABLE "accounting"."journal_entries" DROP CONSTRAINT IF EXISTS "journal_entries_trackedPositionId_fkey";
DROP INDEX IF EXISTS "accounting"."journal_entries_trackedPositionId_idx";
ALTER TABLE "accounting"."journal_entries" DROP COLUMN "trackedPositionId";

-- Drop tracked_positions table
DROP TABLE IF EXISTS "accounting"."tracked_positions";
