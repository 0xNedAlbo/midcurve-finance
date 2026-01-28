-- AlterTable
ALTER TABLE "position_ledger_events" ADD COLUMN     "deltaRealizedCashflow" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "realizedCashflowAfter" TEXT NOT NULL DEFAULT '0';
