/*
  Warnings:

  - You are about to drop the column `monitoringState` on the `close_orders` table. All the data in the column will be lost.
  - You are about to drop the column `onChainStatus` on the `close_orders` table. All the data in the column will be lost.
  - You are about to drop the `close_order_executions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "close_order_executions" DROP CONSTRAINT "close_order_executions_closeOrderId_fkey";

-- DropForeignKey
ALTER TABLE "close_order_executions" DROP CONSTRAINT "close_order_executions_positionId_fkey";

-- DropIndex
DROP INDEX "close_orders_monitoringState_idx";

-- DropIndex
DROP INDEX "close_orders_onChainStatus_idx";

-- DropIndex
DROP INDEX "close_orders_onChainStatus_monitoringState_idx";

-- AlterTable
ALTER TABLE "close_orders" DROP COLUMN "monitoringState",
DROP COLUMN "onChainStatus",
ADD COLUMN     "automationState" TEXT NOT NULL DEFAULT 'monitoring',
ADD COLUMN     "executionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT;

-- DropTable
DROP TABLE "close_order_executions";

-- CreateIndex
CREATE INDEX "close_orders_automationState_idx" ON "close_orders"("automationState");
