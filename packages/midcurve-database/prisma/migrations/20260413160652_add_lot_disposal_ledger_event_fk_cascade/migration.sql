-- Step 1: Add columns as nullable
ALTER TABLE "accounting"."token_lots" ADD COLUMN "positionLedgerEventId" TEXT;
ALTER TABLE "accounting"."token_lot_disposals" ADD COLUMN "positionLedgerEventId" TEXT;

-- Step 2: Backfill existing rows by joining through position
UPDATE "accounting"."token_lots" tl
SET "positionLedgerEventId" = ple.id
FROM "public"."positions" p
JOIN "public"."position_ledger_events" ple ON ple."positionId" = p.id
WHERE p."userId" = tl."userId"
  AND ple."inputHash" = tl."acquisitionEventId";

UPDATE "accounting"."token_lot_disposals" tld
SET "positionLedgerEventId" = ple.id
FROM "public"."positions" p
JOIN "public"."position_ledger_events" ple ON ple."positionId" = p.id
WHERE p."userId" = tld."userId"
  AND ple."inputHash" = tld."disposalEventId";

-- Step 3: Make columns NOT NULL
ALTER TABLE "accounting"."token_lots" ALTER COLUMN "positionLedgerEventId" SET NOT NULL;
ALTER TABLE "accounting"."token_lot_disposals" ALTER COLUMN "positionLedgerEventId" SET NOT NULL;

-- Step 4: Create indexes
CREATE INDEX "token_lots_positionLedgerEventId_idx" ON "accounting"."token_lots"("positionLedgerEventId");
CREATE INDEX "token_lot_disposals_positionLedgerEventId_idx" ON "accounting"."token_lot_disposals"("positionLedgerEventId");

-- Step 5: Add foreign keys with cascade delete
ALTER TABLE "accounting"."token_lots" ADD CONSTRAINT "token_lots_positionLedgerEventId_fkey" FOREIGN KEY ("positionLedgerEventId") REFERENCES "public"."position_ledger_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting"."token_lot_disposals" ADD CONSTRAINT "token_lot_disposals_positionLedgerEventId_fkey" FOREIGN KEY ("positionLedgerEventId") REFERENCES "public"."position_ledger_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
