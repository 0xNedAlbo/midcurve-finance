-- AlterTable
ALTER TABLE "automation_logs" ADD COLUMN     "hedgeVaultId" TEXT;

-- CreateTable
CREATE TABLE "hedge_vaults" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "positionId" TEXT,
    "poolAddress" TEXT NOT NULL,
    "token0IsQuote" BOOLEAN NOT NULL,
    "silSqrtPriceX96" TEXT NOT NULL,
    "tipSqrtPriceX96" TEXT NOT NULL,
    "lossCapBps" INTEGER NOT NULL,
    "reopenCooldownBlocks" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UNINITIALIZED',
    "currentTokenId" TEXT,
    "lastCloseBlock" TEXT,
    "costBasis" TEXT,
    "monitoringStatus" TEXT NOT NULL DEFAULT 'pending',
    "operatorId" TEXT,

    CONSTRAINT "hedge_vaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hedge_vault_executions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vaultId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerSqrtPriceX96" TEXT NOT NULL,
    "executionSqrtPriceX96" TEXT,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "quoteAmount" TEXT,
    "baseAmount" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "hedge_vault_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hedge_vaults_vaultAddress_key" ON "hedge_vaults"("vaultAddress");

-- CreateIndex
CREATE INDEX "hedge_vaults_chainId_poolAddress_idx" ON "hedge_vaults"("chainId", "poolAddress");

-- CreateIndex
CREATE INDEX "hedge_vaults_state_idx" ON "hedge_vaults"("state");

-- CreateIndex
CREATE INDEX "hedge_vaults_monitoringStatus_idx" ON "hedge_vaults"("monitoringStatus");

-- CreateIndex
CREATE INDEX "hedge_vaults_operatorId_idx" ON "hedge_vaults"("operatorId");

-- CreateIndex
CREATE INDEX "hedge_vault_executions_vaultId_idx" ON "hedge_vault_executions"("vaultId");

-- CreateIndex
CREATE INDEX "hedge_vault_executions_status_idx" ON "hedge_vault_executions"("status");

-- CreateIndex
CREATE INDEX "hedge_vault_executions_createdAt_idx" ON "hedge_vault_executions"("createdAt");

-- CreateIndex
CREATE INDEX "automation_logs_hedgeVaultId_idx" ON "automation_logs"("hedgeVaultId");

-- AddForeignKey
ALTER TABLE "automation_logs" ADD CONSTRAINT "automation_logs_hedgeVaultId_fkey" FOREIGN KEY ("hedgeVaultId") REFERENCES "hedge_vaults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedge_vaults" ADD CONSTRAINT "hedge_vaults_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedge_vaults" ADD CONSTRAINT "hedge_vaults_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "automation_wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hedge_vault_executions" ADD CONSTRAINT "hedge_vault_executions_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "hedge_vaults"("id") ON DELETE CASCADE ON UPDATE CASCADE;
