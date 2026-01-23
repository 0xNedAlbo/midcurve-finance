-- Rename transactionLogIndex to logIndex (preserves column position)
ALTER TABLE "pool_prices_uniswapv3" RENAME COLUMN "transactionLogIndex" TO "logIndex";

-- Drop old unique constraint
ALTER TABLE "pool_prices_uniswapv3" DROP CONSTRAINT IF EXISTS "pool_prices_uniswapv3_chainId_blockHash_transactionHash_trans_key";

-- Add new unique constraint with logIndex
ALTER TABLE "pool_prices_uniswapv3" ADD CONSTRAINT "pool_prices_uniswapv3_chainId_blockHash_transactionHash_logIn_key" UNIQUE ("chainId", "blockHash", "transactionHash", "logIndex");

-- Drop old indexes
DROP INDEX IF EXISTS "pool_prices_uniswapv3_latest_first_idx";
DROP INDEX IF EXISTS "pool_prices_uniswapv3_earliest_first_idx";

-- Create new indexes with logIndex (simplified - removed transactionIndex from ordering)
CREATE INDEX "pool_prices_uniswapv3_latest_first_idx" ON "pool_prices_uniswapv3"("poolId", "blockNumber" DESC, "logIndex" DESC);
CREATE INDEX "pool_prices_uniswapv3_earliest_first_idx" ON "pool_prices_uniswapv3"("poolId", "blockNumber" ASC, "logIndex" ASC);
