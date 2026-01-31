/**
 * Uniswap V3 Subgraph GraphQL Queries
 *
 * GraphQL query templates for The Graph Uniswap V3 subgraph.
 * These queries follow the official subgraph schema.
 *
 * Schema reference: https://github.com/Uniswap/v3-subgraph/blob/main/schema.graphql
 */

/**
 * Get lightweight pool metrics (TVL, volume, fees)
 *
 * Returns minimal data for pool ranking and discovery.
 * Uses only the most recent poolDayData for 24h metrics.
 *
 * Variables:
 * - $poolId: Pool address (lowercase, with or without 0x prefix)
 *
 * Returns:
 * - tvlUSD: Total Value Locked in USD
 * - volumeUSD: 24-hour volume in USD
 * - feesUSD: 24-hour fees in USD
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOL_METRICS_QUERY, {
 *   poolId: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
 * });
 * ```
 */
export const POOL_METRICS_QUERY = `
  query GetPoolMetrics($poolId: ID!) {
    pools(where: {id: $poolId}) {
      id
      poolDayData(orderBy: date, orderDirection: desc, first: 1) {
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

/**
 * Get detailed pool fee data for analysis
 *
 * Returns comprehensive pool data including:
 * - Pool state (liquidity, sqrtPrice)
 * - Token metadata (symbols, decimals)
 * - Latest 24h metrics (volumes, prices, fees, TVL)
 *
 * This query is more expensive than POOL_METRICS_QUERY but provides
 * all data needed for:
 * - APR calculations
 * - Fee projections
 * - Position analysis
 * - Price impact estimates
 *
 * Variables:
 * - $poolId: Pool address (lowercase, with or without 0x prefix)
 *
 * Returns:
 * - Pool state and configuration
 * - Token0 and Token1 metadata
 * - Most recent 24h data point
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOL_FEE_DATA_QUERY, {
 *   poolId: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
 * });
 * ```
 */
export const POOL_FEE_DATA_QUERY = `
  query GetPoolFeeData($poolId: ID!) {
    pools(where: {id: $poolId}) {
      id
      feeTier
      sqrtPrice
      liquidity
      token0 {
        id
        symbol
        decimals
      }
      token1 {
        id
        symbol
        decimals
      }
      poolDayData(orderBy: date, orderDirection: desc, first: 1) {
        date
        liquidity
        volumeToken0
        volumeToken1
        token0Price
        token1Price
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

/**
 * Get pool data for multiple pools in a single query
 *
 * Batch query for efficient discovery of multiple pools.
 * Returns the same data as POOL_METRICS_QUERY but for multiple pools.
 *
 * Variables:
 * - $poolIds: Array of pool addresses (lowercase)
 *
 * Returns:
 * - Array of pool objects with metrics
 *
 * Note: The Graph limits array inputs to ~1000 items. For larger batches,
 * split into multiple queries.
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOLS_BATCH_QUERY, {
 *   poolIds: [
 *     '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
 *     '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'
 *   ]
 * });
 * ```
 */
export const POOLS_BATCH_QUERY = `
  query GetPoolsBatch($poolIds: [ID!]!) {
    pools(where: {id_in: $poolIds}) {
      id
      feeTier
      liquidity
      sqrtPrice
      token0 {
        id
        symbol
        decimals
      }
      token1 {
        id
        symbol
        decimals
      }
      poolDayData(orderBy: date, orderDirection: desc, first: 1) {
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

/**
 * Get pool data with 7-day metrics for multiple pools
 *
 * Used by favorites endpoint to fetch full metrics including APR.
 * Returns 7 days of poolDayData for APR calculation.
 *
 * Variables:
 * - $poolIds: Array of pool addresses (lowercase)
 *
 * Returns:
 * - Array of pool objects with 7-day metrics for APR calculation
 *
 * Note: The Graph limits array inputs to ~1000 items. For larger batches,
 * split into multiple queries.
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOLS_BATCH_WITH_METRICS_QUERY, {
 *   poolIds: [
 *     '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
 *     '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'
 *   ]
 * });
 * ```
 */
export const POOLS_BATCH_WITH_METRICS_QUERY = `
  query GetPoolsBatchWithMetrics($poolIds: [ID!]!) {
    pools(where: {id_in: $poolIds}) {
      id
      feeTier
      totalValueLockedUSD
      token0 {
        id
        symbol
        decimals
      }
      token1 {
        id
        symbol
        decimals
      }
      poolDayData(orderBy: date, orderDirection: desc, first: 7) {
        date
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

/**
 * Get historical pool day data
 *
 * Returns daily snapshots of pool metrics for charting and analysis.
 *
 * Variables:
 * - $poolId: Pool address (lowercase)
 * - $days: Number of days to fetch (default: 30, max: 1000)
 *
 * Returns:
 * - Array of daily data points
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOL_HISTORICAL_DATA_QUERY, {
 *   poolId: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
 *   days: 30
 * });
 * ```
 */
export const POOL_HISTORICAL_DATA_QUERY = `
  query GetPoolHistoricalData($poolId: ID!, $days: Int = 30) {
    poolDayDatas(
      where: {pool: $poolId}
      orderBy: date
      orderDirection: desc
      first: $days
    ) {
      date
      liquidity
      volumeUSD
      feesUSD
      tvlUSD
      token0Price
      token1Price
      volumeToken0
      volumeToken1
    }
  }
`;

/**
 * Get pool creation block and timestamp
 *
 * Useful for determining when a pool was deployed and for historical analysis.
 *
 * Variables:
 * - $poolId: Pool address (lowercase)
 *
 * Returns:
 * - Pool creation block and timestamp
 * - First recorded data point
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOL_CREATION_QUERY, {
 *   poolId: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8'
 * });
 * ```
 */
export const POOL_CREATION_QUERY = `
  query GetPoolCreation($poolId: ID!) {
    pools(where: {id: $poolId}) {
      id
      createdAtTimestamp
      createdAtBlockNumber
    }
  }
`;

/**
 * Search pools by token sets
 *
 * Finds all pools where tokens match the provided sets in either direction:
 * - token0 in setA AND token1 in setB, OR
 * - token0 in setB AND token1 in setA
 *
 * Returns pools sorted by TVL descending with 7 days of poolDayData
 * for APR calculation.
 *
 * Variables:
 * - $token0List: Array of token addresses (lowercase)
 * - $token1List: Array of token addresses (lowercase)
 *
 * Returns:
 * - Array of pools with token metadata and 7-day metrics
 *
 * Example usage:
 * ```typescript
 * const response = await query(POOLS_BY_TOKEN_SETS_QUERY, {
 *   token0List: ['0xa0b86991...', '0xdac17f95...'], // USDC, USDT
 *   token1List: ['0xc02aaa39...', '0xae7ab96...']   // WETH, stETH
 * });
 * ```
 */
export const POOLS_BY_TOKEN_SETS_QUERY = `
  query PoolsByTokenSets($token0List: [String!]!, $token1List: [String!]!) {
    pools(
      where: {
        or: [
          { token0_in: $token0List, token1_in: $token1List },
          { token0_in: $token1List, token1_in: $token0List }
        ]
      },
      first: 100,
      orderBy: totalValueLockedUSD,
      orderDirection: desc
    ) {
      id
      feeTier
      liquidity
      sqrtPrice
      tick
      totalValueLockedUSD
      token0 {
        id
        symbol
        decimals
      }
      token1 {
        id
        symbol
        decimals
      }
      poolDayData(orderBy: date, orderDirection: desc, first: 7) {
        date
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

// ============================================================================
// FACTORY VALIDATION
// ============================================================================

/**
 * Query to get the factory address from the subgraph.
 *
 * Used to validate that the subgraph is indexing pools from the expected
 * Uniswap V3 factory contract. The Factory entity's `id` field is the
 * factory contract address (lowercase).
 *
 * @see https://github.com/Uniswap/v3-subgraph/blob/main/src/v3/schema.graphql
 *
 * @returns Factory address from the subgraph
 *
 * @example
 * ```graphql
 * # Response:
 * {
 *   "data": {
 *     "factories": [{
 *       "id": "0x1f98431c8ad98523631ae4a59f267346ea31f984"
 *     }]
 *   }
 * }
 * ```
 */
export const FACTORY_QUERY = `
  query Factory {
    factories(first: 1) {
      id
    }
  }
`;
