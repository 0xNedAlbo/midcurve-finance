-- DropForeignKey
ALTER TABLE "accounting"."token_lot_disposals" DROP CONSTRAINT "token_lot_disposals_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "accounting"."token_lots" DROP CONSTRAINT "token_lots_journalEntryId_fkey";

-- DropIndex
DROP INDEX "accounting"."token_lot_disposals_journalEntryId_idx";

-- DropIndex
DROP INDEX "accounting"."token_lots_journalEntryId_idx";

-- AlterTable
ALTER TABLE "accounting"."journal_entries" ADD COLUMN     "tokenLotDisposalId" TEXT,
ADD COLUMN     "tokenLotId" TEXT;

-- AlterTable
ALTER TABLE "accounting"."token_lot_disposals" DROP COLUMN "journalEntryId";

-- AlterTable
ALTER TABLE "accounting"."token_lots" DROP COLUMN "journalEntryId";

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tokenLotId_key" ON "accounting"."journal_entries"("tokenLotId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tokenLotDisposalId_key" ON "accounting"."journal_entries"("tokenLotDisposalId");

-- AddForeignKey
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_tokenLotId_fkey" FOREIGN KEY ("tokenLotId") REFERENCES "accounting"."token_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting"."journal_entries" ADD CONSTRAINT "journal_entries_tokenLotDisposalId_fkey" FOREIGN KEY ("tokenLotDisposalId") REFERENCES "accounting"."token_lot_disposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

