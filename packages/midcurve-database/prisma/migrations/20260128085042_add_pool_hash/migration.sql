-- AlterTable
ALTER TABLE "pools" ADD COLUMN     "poolHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "pools_poolHash_key" ON "pools"("poolHash");

-- CreateIndex
CREATE INDEX "pools_poolHash_idx" ON "pools"("poolHash");
