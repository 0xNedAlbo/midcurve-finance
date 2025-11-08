/**
 * Uniswap V3 Position Ledger Event Configuration
 *
 * Immutable metadata for a position event on Uniswap V3.
 * Contains blockchain ordering information and liquidity/fee state at event time.
 *
 * Critical for:
 * - Event ordering (blockNumber, txIndex, logIndex)
 * - Event deduplication (inputHash derived from these fields)
 * - PnL calculations (liquidity changes, fees collected)
 * - Price calculations (sqrtPriceX96 at event time)
 */
export interface UniswapV3LedgerEventConfig {
  /**
   * EVM chain ID where event occurred
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * NFT token ID of the position
   * Identifies which position this event belongs to
   */
  nftId: bigint;

  /**
   * Block number where event occurred
   * Used for ordering and deduplication
   */
  blockNumber: bigint;

  /**
   * Transaction index within the block
   * Used for ordering (within same block)
   */
  txIndex: number;

  /**
   * Log index within the transaction
   * Used for ordering (within same transaction)
   */
  logIndex: number;

  /**
   * Transaction hash
   * For reference and verification
   */
  txHash: string;

  /**
   * Change in liquidity (delta L)
   * - Positive for INCREASE_POSITION
   * - Negative for DECREASE_POSITION
   * - Zero for COLLECT
   */
  deltaL: bigint;

  /**
   * Total liquidity after this event
   * Cumulative liquidity state
   */
  liquidityAfter: bigint;

  /**
   * Fees collected in token0 (for COLLECT events)
   * Zero for INCREASE/DECREASE events
   * In smallest token units (e.g., wei for WETH)
   */
  feesCollected0: bigint;

  /**
   * Fees collected in token1 (for COLLECT events)
   * Zero for INCREASE/DECREASE events
   * In smallest token units
   */
  feesCollected1: bigint;

  /**
   * Uncollected principal in token0 after this event
   *
   * Principal = tokens removed via DECREASE but not yet collected.
   * Tracked separately from fees to enable accurate fee accounting.
   *
   * - Increases on DECREASE_POSITION (amount0 added to pool)
   * - Decreases on COLLECT (principal collected)
   * - Unchanged on INCREASE_POSITION
   */
  uncollectedPrincipal0After: bigint;

  /**
   * Uncollected principal in token1 after this event
   * See uncollectedPrincipal0After for details
   */
  uncollectedPrincipal1After: bigint;

  /**
   * Pool price at event time (sqrtPriceX96)
   *
   * Used for:
   * - Calculating token values in quote currency
   * - PnL calculations
   * - Price range validations
   *
   * Format: sqrt(price) * 2^96 (Uniswap V3 Q96 fixed-point)
   */
  sqrtPriceX96: bigint;
}
