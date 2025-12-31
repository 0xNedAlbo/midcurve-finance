-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "realizedCashflow" TEXT NOT NULL DEFAULT '0',
ADD COLUMN     "unrealizedCashflow" TEXT NOT NULL DEFAULT '0';
