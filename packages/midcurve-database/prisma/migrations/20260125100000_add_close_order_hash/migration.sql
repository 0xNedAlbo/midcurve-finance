-- AlterTable
ALTER TABLE "automation_close_orders" ADD COLUMN "closeOrderHash" TEXT;

-- CreateIndex (unique constraint for position + hash)
CREATE UNIQUE INDEX "automation_close_orders_positionId_closeOrderHash_key" ON "automation_close_orders"("positionId", "closeOrderHash");
