-- CreateTable
CREATE TABLE "evm_automation_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "strategyAddress" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kmsKeyId" TEXT NOT NULL,
    "keyProvider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "evm_automation_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evm_automation_wallet_nonces" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "evm_automation_wallet_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evm_automation_wallets_strategyAddress_key" ON "evm_automation_wallets"("strategyAddress");

-- CreateIndex
CREATE INDEX "evm_automation_wallets_walletAddress_idx" ON "evm_automation_wallets"("walletAddress");

-- CreateIndex
CREATE INDEX "evm_automation_wallets_userId_idx" ON "evm_automation_wallets"("userId");

-- CreateIndex
CREATE INDEX "evm_automation_wallet_nonces_walletId_idx" ON "evm_automation_wallet_nonces"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "evm_automation_wallet_nonces_walletId_chainId_key" ON "evm_automation_wallet_nonces"("walletId", "chainId");

-- AddForeignKey
ALTER TABLE "evm_automation_wallet_nonces" ADD CONSTRAINT "evm_automation_wallet_nonces_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "evm_automation_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
