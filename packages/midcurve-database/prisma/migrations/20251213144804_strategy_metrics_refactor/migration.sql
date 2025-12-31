/*
  Warnings:

  - You are about to drop the column `strategyId` on the `positions` table. All the data in the column will be lost.
  - You are about to drop the column `collectedFees` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `currentCostBasis` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `currentValue` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `realizedCashflow` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `realizedPnl` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `skippedPositionIds` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `unClaimedFees` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `unrealizedCashflow` on the `strategies` table. All the data in the column will be lost.
  - You are about to drop the column `unrealizedPnl` on the `strategies` table. All the data in the column will be lost.
  - Made the column `quoteTokenId` on table `strategies` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('pending', 'active', 'paused', 'shutdown');

-- CreateEnum
CREATE TYPE "StrategyPositionStatus" AS ENUM ('pending', 'active', 'paused', 'closed');

-- DropForeignKey
ALTER TABLE "positions" DROP CONSTRAINT "positions_strategyId_fkey";

-- DropForeignKey
ALTER TABLE "strategies" DROP CONSTRAINT "strategies_quoteTokenId_fkey";

-- DropIndex
DROP INDEX "positions_strategyId_idx";

-- DropIndex
DROP INDEX "strategies_state_idx";

-- AlterTable
ALTER TABLE "positions" DROP COLUMN "strategyId";

-- AlterTable
ALTER TABLE "strategies" DROP COLUMN "collectedFees",
DROP COLUMN "currentCostBasis",
DROP COLUMN "currentValue",
DROP COLUMN "realizedCashflow",
DROP COLUMN "realizedPnl",
DROP COLUMN "skippedPositionIds",
DROP COLUMN "state",
DROP COLUMN "unClaimedFees",
DROP COLUMN "unrealizedCashflow",
DROP COLUMN "unrealizedPnl",
ADD COLUMN     "status" "StrategyStatus" NOT NULL DEFAULT 'pending',
ALTER COLUMN "quoteTokenId" SET NOT NULL;

-- DropEnum
DROP TYPE "StrategyState";

-- CreateTable
CREATE TABLE "strategy_positions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "strategyId" TEXT NOT NULL,
    "positionType" TEXT NOT NULL,
    "status" "StrategyPositionStatus" NOT NULL DEFAULT 'pending',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "strategy_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_ledger_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyPositionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "valueInQuote" TEXT NOT NULL,
    "deltaCostBasis" TEXT NOT NULL DEFAULT '0',
    "deltaRealizedCapitalGain" TEXT NOT NULL DEFAULT '0',
    "deltaRealizedIncome" TEXT NOT NULL DEFAULT '0',
    "deltaExpense" TEXT NOT NULL DEFAULT '0',
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "strategy_ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_positions_strategyId_idx" ON "strategy_positions"("strategyId");

-- CreateIndex
CREATE INDEX "strategy_positions_positionType_idx" ON "strategy_positions"("positionType");

-- CreateIndex
CREATE INDEX "strategy_positions_status_idx" ON "strategy_positions"("status");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_strategyId_idx" ON "strategy_ledger_events"("strategyId");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_strategyPositionId_idx" ON "strategy_ledger_events"("strategyPositionId");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_groupId_idx" ON "strategy_ledger_events"("groupId");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_timestamp_sequenceNumber_idx" ON "strategy_ledger_events"("timestamp", "sequenceNumber");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_tokenId_idx" ON "strategy_ledger_events"("tokenId");

-- CreateIndex
CREATE INDEX "strategy_ledger_events_eventType_idx" ON "strategy_ledger_events"("eventType");

-- CreateIndex
CREATE INDEX "strategies_status_idx" ON "strategies"("status");

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_quoteTokenId_fkey" FOREIGN KEY ("quoteTokenId") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_positions" ADD CONSTRAINT "strategy_positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_ledger_events" ADD CONSTRAINT "strategy_ledger_events_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_ledger_events" ADD CONSTRAINT "strategy_ledger_events_strategyPositionId_fkey" FOREIGN KEY ("strategyPositionId") REFERENCES "strategy_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_ledger_events" ADD CONSTRAINT "strategy_ledger_events_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
