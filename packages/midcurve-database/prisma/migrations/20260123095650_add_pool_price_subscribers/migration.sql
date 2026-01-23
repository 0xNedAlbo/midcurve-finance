-- CreateTable
CREATE TABLE "pool_price_subscribers" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "subscriptionTag" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastMessageAck" TIMESTAMP(3),

    CONSTRAINT "pool_price_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pool_price_subscribers_poolId_idx" ON "pool_price_subscribers"("poolId");

-- CreateIndex
CREATE INDEX "pool_price_subscribers_isActive_idx" ON "pool_price_subscribers"("isActive");

-- CreateIndex
CREATE INDEX "pool_price_subscribers_subscriptionTag_idx" ON "pool_price_subscribers"("subscriptionTag");

-- AddForeignKey
ALTER TABLE "pool_price_subscribers" ADD CONSTRAINT "pool_price_subscribers_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
