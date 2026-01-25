-- AlterTable
ALTER TABLE "automation_close_orders" ADD COLUMN     "sharedContractId" TEXT;

-- CreateIndex
CREATE INDEX "automation_close_orders_sharedContractId_idx" ON "automation_close_orders"("sharedContractId");

-- AddForeignKey
ALTER TABLE "automation_close_orders" ADD CONSTRAINT "automation_close_orders_sharedContractId_fkey" FOREIGN KEY ("sharedContractId") REFERENCES "shared_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
