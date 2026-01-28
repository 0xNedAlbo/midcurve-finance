-- AlterTable
ALTER TABLE "position_ledger_events" ADD COLUMN     "collectedFeesAfter" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "deltaCollectedFees" TEXT NOT NULL DEFAULT '0';
