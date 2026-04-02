/**
 * Pool Price Input Types
 *
 * Input types for pool price service operations.
 */

// =============================================================================
// DISCOVERY INPUTS
// =============================================================================

/**
 * Uniswap V3 Pool Price Discovery Input
 *
 * Protocol-specific parameters needed to discover a historic pool price snapshot.
 * The poolId is passed separately as a common parameter.
 */
export interface UniswapV3PoolPriceDiscoverInput {
  /**
   * Block number to fetch the price at
   * Must be a valid historical block number
   */
  blockNumber: number;

  /**
   * Optional block hash for reorg detection without RPC.
   * When provided, cached prices are validated against this hash in-memory
   * instead of fetching the block from chain. The caller (e.g., ledger service)
   * typically has this from the raw log event data.
   */
  blockHash?: string;
}
