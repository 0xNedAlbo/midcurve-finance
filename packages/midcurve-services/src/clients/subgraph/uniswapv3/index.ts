/**
 * Uniswap V3 Subgraph Client Exports
 *
 * Client for querying The Graph subgraphs for Uniswap V3 protocol data
 */

// Main client
export { UniswapV3SubgraphClient } from './uniswapv3-subgraph-client.js';
export type { UniswapV3SubgraphClientDependencies } from './uniswapv3-subgraph-client.js';

// Types
export type {
  SubgraphResponse,
  PoolMetrics,
  PoolFeeData,
  RawPoolData,
  RawPoolSearchData,
  PoolSearchSubgraphResult,
} from './types.js';

// Error types
export {
  UniswapV3SubgraphApiError,
  UniswapV3SubgraphUnavailableError,
  PoolNotFoundInSubgraphError,
} from './types.js';

// Query templates (re-export for advanced usage)
export {
  POOL_METRICS_QUERY,
  POOL_FEE_DATA_QUERY,
  POOLS_BATCH_QUERY,
  POOL_HISTORICAL_DATA_QUERY,
  POOL_CREATION_QUERY,
  POOLS_BY_TOKEN_SETS_QUERY,
} from './queries.js';
