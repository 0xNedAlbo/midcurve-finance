/*
  Warnings:

  - You are about to drop the column `closeOrderId` on the `automation_logs` table. All the data in the column will be lost.
  - You are about to drop the column `hedgeVaultId` on the `automation_logs` table. All the data in the column will be lost.
  - You are about to drop the `automation_close_orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `hedge_vault_executions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `hedge_vaults` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "automation_close_orders" DROP CONSTRAINT "automation_close_orders_positionId_fkey";

-- DropForeignKey
ALTER TABLE "automation_close_orders" DROP CONSTRAINT "automation_close_orders_sharedContractId_fkey";

-- DropForeignKey
ALTER TABLE "automation_logs" DROP CONSTRAINT "automation_logs_closeOrderId_fkey";

-- DropForeignKey
ALTER TABLE "automation_logs" DROP CONSTRAINT "automation_logs_hedgeVaultId_fkey";

-- DropForeignKey
ALTER TABLE "hedge_vault_executions" DROP CONSTRAINT "hedge_vault_executions_vaultId_fkey";

-- DropForeignKey
ALTER TABLE "hedge_vaults" DROP CONSTRAINT "hedge_vaults_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "hedge_vaults" DROP CONSTRAINT "hedge_vaults_positionId_fkey";

-- DropIndex
DROP INDEX "automation_logs_closeOrderId_idx";

-- DropIndex
DROP INDEX "automation_logs_hedgeVaultId_idx";

-- AlterTable
ALTER TABLE "automation_logs" DROP COLUMN "closeOrderId",
DROP COLUMN "hedgeVaultId",
ADD COLUMN     "onChainCloseOrderId" TEXT;

-- DropTable
DROP TABLE "automation_close_orders";

-- DropTable
DROP TABLE "hedge_vault_executions";

-- DropTable
DROP TABLE "hedge_vaults";

-- CreateTable
CREATE TABLE "on_chain_close_orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "nftId" TEXT NOT NULL,
    "triggerMode" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "sharedContractId" TEXT,
    "onChainStatus" INTEGER NOT NULL DEFAULT 0,
    "triggerTick" INTEGER,
    "slippageBps" INTEGER,
    "payoutAddress" TEXT,
    "operatorAddress" TEXT,
    "owner" TEXT,
    "pool" TEXT,
    "validUntil" TIMESTAMP(3),
    "swapDirection" INTEGER NOT NULL DEFAULT 0,
    "swapSlippageBps" INTEGER NOT NULL DEFAULT 0,
    "monitoringState" TEXT NOT NULL DEFAULT 'idle',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncBlock" INTEGER,
    "registrationTxHash" TEXT,
    "registeredAt" TIMESTAMP(3),
    "closeOrderHash" TEXT,

    CONSTRAINT "on_chain_close_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_order_executions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onChainCloseOrderId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "triggerSqrtPriceX96" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "txHash" TEXT,
    "executionSqrtPriceX96" TEXT,
    "executionFeeBps" INTEGER,
    "amount0Out" TEXT,
    "amount1Out" TEXT,
    "swapExecution" JSONB,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "close_order_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "on_chain_close_orders_onChainStatus_idx" ON "on_chain_close_orders"("onChainStatus");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_monitoringState_idx" ON "on_chain_close_orders"("monitoringState");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_positionId_idx" ON "on_chain_close_orders"("positionId");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_chainId_contractAddress_idx" ON "on_chain_close_orders"("chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_pool_idx" ON "on_chain_close_orders"("pool");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_onChainStatus_monitoringState_idx" ON "on_chain_close_orders"("onChainStatus", "monitoringState");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_closeOrderHash_idx" ON "on_chain_close_orders"("closeOrderHash");

-- CreateIndex
CREATE INDEX "on_chain_close_orders_sharedContractId_idx" ON "on_chain_close_orders"("sharedContractId");

-- CreateIndex
CREATE UNIQUE INDEX "on_chain_close_orders_positionId_triggerMode_key" ON "on_chain_close_orders"("positionId", "triggerMode");

-- CreateIndex
CREATE UNIQUE INDEX "on_chain_close_orders_chainId_nftId_triggerMode_key" ON "on_chain_close_orders"("chainId", "nftId", "triggerMode");

-- CreateIndex
CREATE INDEX "close_order_executions_onChainCloseOrderId_idx" ON "close_order_executions"("onChainCloseOrderId");

-- CreateIndex
CREATE INDEX "close_order_executions_positionId_idx" ON "close_order_executions"("positionId");

-- CreateIndex
CREATE INDEX "close_order_executions_status_idx" ON "close_order_executions"("status");

-- CreateIndex
CREATE INDEX "close_order_executions_createdAt_idx" ON "close_order_executions"("createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_onChainCloseOrderId_idx" ON "automation_logs"("onChainCloseOrderId");

-- AddForeignKey
ALTER TABLE "on_chain_close_orders" ADD CONSTRAINT "on_chain_close_orders_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_chain_close_orders" ADD CONSTRAINT "on_chain_close_orders_sharedContractId_fkey" FOREIGN KEY ("sharedContractId") REFERENCES "shared_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_order_executions" ADD CONSTRAINT "close_order_executions_onChainCloseOrderId_fkey" FOREIGN KEY ("onChainCloseOrderId") REFERENCES "on_chain_close_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_order_executions" ADD CONSTRAINT "close_order_executions_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_onChainCloseOrderId_fkey" FOREIGN KEY ("onChainCloseOrderId") REFERENCES "on_chain_close_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
