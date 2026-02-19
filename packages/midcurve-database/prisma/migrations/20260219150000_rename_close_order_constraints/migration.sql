-- AlterTable
ALTER TABLE "close_orders" RENAME CONSTRAINT "on_chain_close_orders_pkey" TO "close_orders_pkey";

-- RenameForeignKey
ALTER TABLE "automation_logs" RENAME CONSTRAINT "automation_logs_onChainCloseOrderId_fkey" TO "automation_logs_closeOrderId_fkey";

-- RenameForeignKey
ALTER TABLE "close_order_executions" RENAME CONSTRAINT "close_order_executions_onChainCloseOrderId_fkey" TO "close_order_executions_closeOrderId_fkey";

-- RenameForeignKey
ALTER TABLE "close_orders" RENAME CONSTRAINT "on_chain_close_orders_positionId_fkey" TO "close_orders_positionId_fkey";

-- RenameForeignKey
ALTER TABLE "close_orders" RENAME CONSTRAINT "on_chain_close_orders_sharedContractId_fkey" TO "close_orders_sharedContractId_fkey";

-- RenameIndex
ALTER INDEX "automation_logs_onChainCloseOrderId_idx" RENAME TO "automation_logs_closeOrderId_idx";

-- RenameIndex
ALTER INDEX "close_order_executions_onChainCloseOrderId_idx" RENAME TO "close_order_executions_closeOrderId_idx";
