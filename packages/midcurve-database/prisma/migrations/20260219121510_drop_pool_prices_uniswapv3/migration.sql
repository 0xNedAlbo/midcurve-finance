/*
  Warnings:

  - You are about to drop the `pool_prices_uniswapv3` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "pool_prices_uniswapv3" DROP CONSTRAINT "pool_prices_uniswapv3_poolId_fkey";

-- DropTable
DROP TABLE "pool_prices_uniswapv3";
