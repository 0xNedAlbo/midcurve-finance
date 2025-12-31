/*
  Warnings:

  - You are about to drop the `evm_automation_wallet_nonces` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `evm_automation_wallets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "evm_automation_wallet_nonces" DROP CONSTRAINT "evm_automation_wallet_nonces_walletId_fkey";

-- DropTable
DROP TABLE "evm_automation_wallet_nonces";

-- DropTable
DROP TABLE "evm_automation_wallets";

-- CreateTable
CREATE TABLE "automation_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "walletHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "automation_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_wallet_nonces" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "automation_wallet_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_wallets_walletHash_key" ON "automation_wallets"("walletHash");

-- CreateIndex
CREATE INDEX "automation_wallets_walletType_idx" ON "automation_wallets"("walletType");

-- CreateIndex
CREATE INDEX "automation_wallets_userId_idx" ON "automation_wallets"("userId");

-- CreateIndex
CREATE INDEX "automation_wallets_isActive_idx" ON "automation_wallets"("isActive");

-- CreateIndex
CREATE INDEX "automation_wallets_userId_walletHash_idx" ON "automation_wallets"("userId", "walletHash");

-- CreateIndex
CREATE UNIQUE INDEX "automation_wallet_nonces_nonceHash_key" ON "automation_wallet_nonces"("nonceHash");

-- CreateIndex
CREATE INDEX "automation_wallet_nonces_walletId_idx" ON "automation_wallet_nonces"("walletId");

-- AddForeignKey
ALTER TABLE "automation_wallet_nonces" ADD CONSTRAINT "automation_wallet_nonces_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "automation_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
