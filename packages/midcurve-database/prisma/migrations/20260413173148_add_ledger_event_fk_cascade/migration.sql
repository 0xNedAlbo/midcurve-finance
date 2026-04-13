-- DropIndex
DROP INDEX "accounting"."journal_entries_ledgerEventRef_idx";

-- AlterTable
ALTER TABLE "accounting"."journal_entries" DROP COLUMN "ledgerEventRef",
ADD COLUMN     "positionLedgerEventId" TEXT;

-- CreateIndex
CREATE INDEX "journal_entries_positionLedgerEventId_idx" ON "accounting"."journal_entries"("positionLedgerEventId");

-- AddForeignKey
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_positionLedgerEventId_fkey" FOREIGN KEY ("positionLedgerEventId") REFERENCES "public"."position_ledger_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

