-- DropIndex
DROP INDEX IF EXISTS "position_ledger_events_inputHash_key";

-- DropIndex
DROP INDEX IF EXISTS "position_ledger_events_inputHash_idx";

-- CreateIndex (composite unique constraint for deduplication per-position)
CREATE UNIQUE INDEX "position_ledger_events_positionId_inputHash_key" ON "position_ledger_events"("positionId", "inputHash");
