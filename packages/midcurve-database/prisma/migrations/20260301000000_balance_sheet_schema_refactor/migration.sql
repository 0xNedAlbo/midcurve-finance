-- =============================================================================
-- Balance Sheet Schema Refactor
-- Combines: A1 (JournalLine rename), A2 (TrackedInstrument rename),
--           A3 (backfill instrumentRef), C1 (NAVSnapshot extension)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A1: JournalLine — rename instrumentRef → positionRef, add new instrumentRef
-- ---------------------------------------------------------------------------

-- Rename existing column
ALTER TABLE accounting.journal_lines RENAME COLUMN "instrumentRef" TO "positionRef";

-- Add new instrumentRef column (pool hash, denormalized)
ALTER TABLE accounting.journal_lines ADD COLUMN "instrumentRef" TEXT;

-- Drop old indexes (they referenced the old instrumentRef which was position hash)
DROP INDEX IF EXISTS accounting."journal_lines_instrumentRef_idx";
DROP INDEX IF EXISTS accounting."journal_lines_accountId_instrumentRef_idx";

-- Create new indexes
CREATE INDEX "journal_lines_positionRef_idx" ON accounting.journal_lines("positionRef");
CREATE INDEX "journal_lines_accountId_positionRef_idx" ON accounting.journal_lines("accountId", "positionRef");
CREATE INDEX "journal_lines_instrumentRef_idx" ON accounting.journal_lines("instrumentRef");
CREATE INDEX "journal_lines_accountId_instrumentRef_idx" ON accounting.journal_lines("accountId", "instrumentRef");

-- ---------------------------------------------------------------------------
-- A2: TrackedInstrument → TrackedPosition
-- ---------------------------------------------------------------------------

-- Rename table
ALTER TABLE accounting.tracked_instruments RENAME TO tracked_positions;

-- Rename column
ALTER TABLE accounting.tracked_positions RENAME COLUMN "instrumentRef" TO "positionRef";

-- ---------------------------------------------------------------------------
-- A3: Backfill instrumentRef on existing journal lines from pool hash
-- ---------------------------------------------------------------------------

UPDATE accounting.journal_lines jl
SET "instrumentRef" = p."poolHash"
FROM public.positions pos
JOIN public.pools p ON pos."poolId" = p.id
WHERE pos."positionHash" = jl."positionRef"
  AND jl."positionRef" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- C1: NAVSnapshot — replace old aggregate columns with granular line items
-- ---------------------------------------------------------------------------

-- Drop old columns
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "totalContributedCapital";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "totalCapitalReturned";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "totalAccumulatedPnl";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "periodFeeIncome";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "periodRealizedPnl";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "periodUnrealizedPnl";
ALTER TABLE accounting.nav_snapshots DROP COLUMN IF EXISTS "periodGasExpense";

-- Add asset breakdown columns
ALTER TABLE accounting.nav_snapshots ADD COLUMN "depositedLiquidityAtCost" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "markToMarketAdjustment" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "unclaimedFees" TEXT NOT NULL DEFAULT '0';

-- Add equity breakdown columns
ALTER TABLE accounting.nav_snapshots ADD COLUMN "contributedCapital" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "capitalReturned" TEXT NOT NULL DEFAULT '0';

-- Add retained earnings sub-category columns
ALTER TABLE accounting.nav_snapshots ADD COLUMN "retainedRealizedWithdrawals" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "retainedRealizedFees" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "retainedUnrealizedPrice" TEXT NOT NULL DEFAULT '0';
ALTER TABLE accounting.nav_snapshots ADD COLUMN "retainedUnrealizedFees" TEXT NOT NULL DEFAULT '0';
