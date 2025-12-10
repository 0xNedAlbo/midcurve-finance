-- CreateEnum
CREATE TYPE "StrategyState" AS ENUM ('pending', 'active', 'paused', 'shutdown');

-- AlterTable
ALTER TABLE "automation_wallets" ADD COLUMN     "strategyId" TEXT;

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "strategyId" TEXT;

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategyType" TEXT NOT NULL,
    "state" "StrategyState" NOT NULL DEFAULT 'pending',
    "contractAddress" TEXT,
    "chainId" INTEGER,
    "quoteTokenId" TEXT,
    "currentValue" TEXT NOT NULL DEFAULT '0',
    "currentCostBasis" TEXT NOT NULL DEFAULT '0',
    "realizedPnl" TEXT NOT NULL DEFAULT '0',
    "unrealizedPnl" TEXT NOT NULL DEFAULT '0',
    "collectedFees" TEXT NOT NULL DEFAULT '0',
    "unClaimedFees" TEXT NOT NULL DEFAULT '0',
    "realizedCashflow" TEXT NOT NULL DEFAULT '0',
    "unrealizedCashflow" TEXT NOT NULL DEFAULT '0',
    "config" JSONB NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategies_contractAddress_key" ON "strategies"("contractAddress");

-- CreateIndex
CREATE INDEX "strategies_userId_idx" ON "strategies"("userId");

-- CreateIndex
CREATE INDEX "strategies_state_idx" ON "strategies"("state");

-- CreateIndex
CREATE INDEX "strategies_strategyType_idx" ON "strategies"("strategyType");

-- CreateIndex
CREATE INDEX "strategies_quoteTokenId_idx" ON "strategies"("quoteTokenId");

-- CreateIndex
CREATE INDEX "automation_wallets_strategyId_idx" ON "automation_wallets"("strategyId");

-- CreateIndex
CREATE INDEX "positions_strategyId_idx" ON "positions"("strategyId");

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_quoteTokenId_fkey" FOREIGN KEY ("quoteTokenId") REFERENCES "tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_wallets" ADD CONSTRAINT "automation_wallets_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
