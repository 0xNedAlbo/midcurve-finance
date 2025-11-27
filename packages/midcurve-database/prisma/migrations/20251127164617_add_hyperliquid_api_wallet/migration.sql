-- CreateTable
CREATE TABLE "hyperliquid_api_wallets" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "environment" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "hyperliquid_api_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hyperliquid_api_wallets_userId_idx" ON "hyperliquid_api_wallets"("userId");

-- CreateIndex
CREATE INDEX "hyperliquid_api_wallets_isActive_idx" ON "hyperliquid_api_wallets"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "hyperliquid_api_wallets_userId_walletAddress_environment_key" ON "hyperliquid_api_wallets"("userId", "walletAddress", "environment");

-- AddForeignKey
ALTER TABLE "hyperliquid_api_wallets" ADD CONSTRAINT "hyperliquid_api_wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
