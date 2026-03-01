-- Step 1: Add column as nullable first (to allow backfill before NOT NULL)
ALTER TABLE "accounting"."journal_entries" ADD COLUMN "trackedPositionId" TEXT;

-- Step 2: Backfill existing journal entries by matching through journal_lines.positionRef
UPDATE "accounting"."journal_entries" je
SET "trackedPositionId" = sub.tracked_id
FROM (
  SELECT DISTINCT ON (jl."journalEntryId")
    jl."journalEntryId",
    tp.id AS tracked_id
  FROM "accounting"."journal_lines" jl
  INNER JOIN "accounting"."tracked_positions" tp
    ON jl."positionRef" = tp."positionRef"
  INNER JOIN "accounting"."journal_entries" je2
    ON jl."journalEntryId" = je2.id
    AND je2."userId" = tp."userId"
  WHERE jl."positionRef" IS NOT NULL
) sub
WHERE je.id = sub."journalEntryId";

-- Step 3: Delete orphaned journal entries that could not be matched
-- (entries without a corresponding tracked position — should not exist in practice)
DELETE FROM "accounting"."journal_entries"
WHERE "trackedPositionId" IS NULL;

-- Step 4: Make column NOT NULL now that all rows are backfilled
ALTER TABLE "accounting"."journal_entries" ALTER COLUMN "trackedPositionId" SET NOT NULL;

-- Step 5: Create index for efficient cascade lookups and queries
CREATE INDEX "journal_entries_trackedPositionId_idx" ON "accounting"."journal_entries"("trackedPositionId");

-- Step 6: Add foreign key constraint with cascade delete
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_trackedPositionId_fkey" FOREIGN KEY ("trackedPositionId") REFERENCES "accounting"."tracked_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
