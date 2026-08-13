-- Automation log dedupe key (#79)
--
-- automation_logs had no dedupe key, so a replayed on-chain event appended a
-- second ORDER_MODIFIED row on every pass over a block range that contained a
-- config update. sourceEventKey identifies the on-chain log a row was derived
-- from — "{chainId}/{transactionHash}/{logIndex}" — and the unique index below
-- makes the write idempotent per position.
--
-- WHY THE COLUMN IS NULLABLE, AND WHY THE INDEX MUST STAY NULL-DISTINCT
--
-- Two facts hold this migration up. Both are easy to undo by accident later,
-- which is why they are recorded here rather than only in the pull request.
--
-- 1. Every pre-existing row gets sourceEventKey = NULL, and PostgreSQL treats
--    NULLs in a unique index as distinct from each other. So existing rows are
--    exempt by construction — including the duplicates this issue is about.
--    That is what makes the migration safe against a database nobody can
--    inspect beforehand: it cannot fail on duplicate data, because no
--    pre-existing row participates in the constraint at all. There is
--    deliberately no backfill and no cleanup; see #79 for that decision.
--
-- 2. Log writes with no source event — user actions through the API, the
--    executor's own entries — also carry NULL, and must stay repeatable. The
--    same NULL-distinct rule is what leaves them unconstrained.
--
-- Do NOT add NULLS NOT DISTINCT (PostgreSQL 15+) to this index. It would
-- destroy both properties at once: this migration would start failing on any
-- database holding more than one keyless row, and every future keyless write
-- would collide with the first one. If you are here because you want to tighten
-- the index, the change you actually want is to make the column NOT NULL for
-- event-derived rows only — which a single index cannot express.

-- AlterTable: nullable by design, see above
ALTER TABLE "public"."automation_logs" ADD COLUMN "sourceEventKey" TEXT;

-- Dedupe per position, matching the position_ledger_events precedent
-- (@@unique([positionId, inputHash])). Deliberately does not include logType:
-- one source event produces at most one log row on any pass, so a narrower
-- constraint would add nothing, and a wider one would let a replay through.
CREATE UNIQUE INDEX "automation_logs_positionId_sourceEventKey_key" ON "public"."automation_logs"("positionId", "sourceEventKey");
