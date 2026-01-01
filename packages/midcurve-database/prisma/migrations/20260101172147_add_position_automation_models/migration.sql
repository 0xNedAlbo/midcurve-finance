-- AlterTable
ALTER TABLE "automation_wallets" ADD COLUMN     "walletPurpose" TEXT NOT NULL DEFAULT 'strategy';

-- CreateTable
CREATE TABLE "automation_contracts" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contractType" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "automation_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_close_orders" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orderType" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "automation_close_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_price_subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "poolId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeOrderCount" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,

    CONSTRAINT "pool_price_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_contracts_userId_idx" ON "automation_contracts"("userId");

-- CreateIndex
CREATE INDEX "automation_contracts_contractType_idx" ON "automation_contracts"("contractType");

-- CreateIndex
CREATE INDEX "automation_contracts_isActive_idx" ON "automation_contracts"("isActive");

-- CreateIndex
CREATE INDEX "automation_contracts_userId_contractType_idx" ON "automation_contracts"("userId", "contractType");

-- CreateIndex
CREATE INDEX "automation_close_orders_contractId_idx" ON "automation_close_orders"("contractId");

-- CreateIndex
CREATE INDEX "automation_close_orders_orderType_idx" ON "automation_close_orders"("orderType");

-- CreateIndex
CREATE INDEX "automation_close_orders_status_idx" ON "automation_close_orders"("status");

-- CreateIndex
CREATE INDEX "automation_close_orders_positionId_idx" ON "automation_close_orders"("positionId");

-- CreateIndex
CREATE INDEX "automation_close_orders_contractId_status_idx" ON "automation_close_orders"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pool_price_subscriptions_poolId_key" ON "pool_price_subscriptions"("poolId");

-- CreateIndex
CREATE INDEX "pool_price_subscriptions_isActive_idx" ON "pool_price_subscriptions"("isActive");

-- CreateIndex
CREATE INDEX "pool_price_subscriptions_activeOrderCount_idx" ON "pool_price_subscriptions"("activeOrderCount");

-- CreateIndex
CREATE INDEX "automation_wallets_walletPurpose_idx" ON "automation_wallets"("walletPurpose");

-- AddForeignKey
ALTER TABLE "automation_close_orders" ADD CONSTRAINT "automation_close_orders_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "automation_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_close_orders" ADD CONSTRAINT "automation_close_orders_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_price_subscriptions" ADD CONSTRAINT "pool_price_subscriptions_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
