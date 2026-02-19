-- RenameCloseOrdersTable
--
-- Renames the table and FK columns to match the CloseOrder model name.
-- No data migration needed — just table/column/index renames.

-- Rename table
ALTER TABLE "on_chain_close_orders" RENAME TO "close_orders";

-- Rename FK columns
ALTER TABLE "close_order_executions" RENAME COLUMN "onChainCloseOrderId" TO "closeOrderId";
ALTER TABLE "automation_logs" RENAME COLUMN "onChainCloseOrderId" TO "closeOrderId";

-- Rename indexes that reference the old table name
ALTER INDEX "on_chain_close_orders_orderIdentityHash_key" RENAME TO "close_orders_orderIdentityHash_key";
ALTER INDEX "on_chain_close_orders_positionId_closeOrderHash_key" RENAME TO "close_orders_positionId_closeOrderHash_key";
ALTER INDEX "on_chain_close_orders_protocol_idx" RENAME TO "close_orders_protocol_idx";
ALTER INDEX "on_chain_close_orders_onChainStatus_idx" RENAME TO "close_orders_onChainStatus_idx";
ALTER INDEX "on_chain_close_orders_monitoringState_idx" RENAME TO "close_orders_monitoringState_idx";
ALTER INDEX "on_chain_close_orders_positionId_idx" RENAME TO "close_orders_positionId_idx";
ALTER INDEX "on_chain_close_orders_onChainStatus_monitoringState_idx" RENAME TO "close_orders_onChainStatus_monitoringState_idx";
ALTER INDEX "on_chain_close_orders_closeOrderHash_idx" RENAME TO "close_orders_closeOrderHash_idx";
ALTER INDEX "on_chain_close_orders_sharedContractId_idx" RENAME TO "close_orders_sharedContractId_idx";
