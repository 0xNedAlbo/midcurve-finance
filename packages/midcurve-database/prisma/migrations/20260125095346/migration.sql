/*
  Warnings:

  - You are about to drop the column `strategyId` on the `automation_wallets` table. All the data in the column will be lost.
  - You are about to drop the `strategies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `strategy_ledger_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `strategy_logs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `strategy_positions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "automation_wallets" DROP CONSTRAINT "automation_wallets_strategyId_fkey";

-- DropForeignKey
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_quoteTokenId_fkey";

-- DropForeignKey
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_userId_fkey";

-- DropForeignKey
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_vaultTokenId_fkey";

-- DropForeignKey
ALTER TABLE "strategy_ledger_events" DROP CONSTRAINT "strategy_ledger_events_strategyId_fkey";

-- DropForeignKey
ALTER TABLE "strategy_ledger_events" DROP CONSTRAINT "strategy_ledger_events_strategyPositionId_fkey";

-- DropForeignKey
ALTER TABLE "strategy_ledger_events" DROP CONSTRAINT "strategy_ledger_events_tokenId_fkey";

-- DropForeignKey
ALTER TABLE "strategy_logs" DROP CONSTRAINT "strategy_logs_strategyId_fkey";

-- DropForeignKey
ALTER TABLE "strategy_positions" DROP CONSTRAINT "strategy_positions_strategyId_fkey";

-- DropIndex
DROP INDEX "automation_wallets_strategyId_idx";

-- AlterTable
ALTER TABLE "automation_wallets" DROP COLUMN "strategyId",
ALTER COLUMN "walletPurpose" SET DEFAULT 'automation';

-- DropTable
DROP TABLE "strategies";

-- DropTable
DROP TABLE "strategy_ledger_events";

-- DropTable
DROP TABLE "strategy_logs";

-- DropTable
DROP TABLE "strategy_positions";

-- DropEnum
DROP TYPE "StrategyPositionStatus";

-- DropEnum
DROP TYPE "StrategyStatus";
