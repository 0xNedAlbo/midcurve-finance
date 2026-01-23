-- CreateTable
CREATE TABLE "pool_prices_uniswapv3" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "blockHash" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "transactionIndex" INTEGER NOT NULL,
    "transactionLogIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "poolId" TEXT NOT NULL,
    "sqrtPriceX96" TEXT NOT NULL,
    "token1PricePerToken0" TEXT NOT NULL,
    "token0PricePerToken1" TEXT NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pool_prices_uniswapv3_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pool_prices_uniswapv3_latest_first_idx" ON "pool_prices_uniswapv3"("poolId", "blockNumber" DESC, "transactionIndex" DESC, "transactionLogIndex" DESC);

-- CreateIndex
CREATE INDEX "pool_prices_uniswapv3_earliest_first_idx" ON "pool_prices_uniswapv3"("poolId", "blockNumber" ASC, "transactionIndex" ASC, "transactionLogIndex" ASC);

-- CreateIndex
CREATE INDEX "pool_prices_uniswapv3_chainId_idx" ON "pool_prices_uniswapv3"("chainId");

-- CreateIndex
CREATE INDEX "pool_prices_uniswapv3_isFinal_idx" ON "pool_prices_uniswapv3"("isFinal");

-- CreateIndex
CREATE UNIQUE INDEX "pool_prices_uniswapv3_chainId_blockHash_transactionHash_tra_key" ON "pool_prices_uniswapv3"("chainId", "blockHash", "transactionHash", "transactionLogIndex");

-- AddForeignKey
ALTER TABLE "pool_prices_uniswapv3" ADD CONSTRAINT "pool_prices_uniswapv3_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
