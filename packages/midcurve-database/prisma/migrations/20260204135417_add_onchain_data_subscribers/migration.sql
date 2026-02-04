-- CreateTable
CREATE TABLE "onchain_data_subscribers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionType" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastPolledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "state" JSONB NOT NULL,

    CONSTRAINT "onchain_data_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onchain_data_subscribers_subscriptionId_key" ON "onchain_data_subscribers"("subscriptionId");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_subscriptionType_idx" ON "onchain_data_subscribers"("subscriptionType");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_status_idx" ON "onchain_data_subscribers"("status");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_subscriptionType_status_idx" ON "onchain_data_subscribers"("subscriptionType", "status");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_lastPolledAt_idx" ON "onchain_data_subscribers"("lastPolledAt");

-- CreateIndex
CREATE INDEX "onchain_data_subscribers_pausedAt_idx" ON "onchain_data_subscribers"("pausedAt");
