-- AlterTable
ALTER TABLE "pool_price_subscribers" ADD COLUMN     "queueName" TEXT;

-- CreateIndex
CREATE INDEX "pool_price_subscribers_queueName_idx" ON "pool_price_subscribers"("queueName");
