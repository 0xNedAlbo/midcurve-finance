-- AddLedgerEventBlockNumberExpressionIndex
--
-- Fixes a correctness bug: blockNumber is stored as a decimal string inside the
-- config JSONB column. Prisma JSON path queries (lte, gte) use lexicographic
-- comparison, not numeric — e.g. "9999999" > "21000000" because "9" > "2".
--
-- This expression index enables efficient numeric comparison and ordering
-- by casting the JSON string to BIGINT at index time.

CREATE INDEX "position_ledger_events_positionId_blockNumber_logIndex_idx"
  ON "position_ledger_events" (
    "positionId",
    ((config->>'blockNumber')::BIGINT) DESC,
    ((config->>'logIndex')::INTEGER) DESC
  );
