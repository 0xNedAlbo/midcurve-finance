-- DropForeignKey
ALTER TABLE "pool_prices" DROP CONSTRAINT "pool_prices_poolId_fkey";

-- AddForeignKey
ALTER TABLE "pool_prices" ADD CONSTRAINT "pool_prices_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
