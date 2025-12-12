/**
 * HODL Position Ledger Event Configuration
 *
 * Immutable metadata for a position event on HODL positions.
 * Contains blockchain ordering information and token state at event time.
 *
 * Critical for:
 * - Event ordering (blockNumber, txIndex, logIndex)
 * - Event deduplication (inputHash derived from these fields)
 * - PnL calculations (tokenPriceInQuote at event time)
 * - Holdings state tracking (balanceAfter, costBasisAfter)
 */

export interface HodlLedgerEventConfig {
  /**
   * EVM chain ID where event occurred
   *
   * Note: HODL positions can include tokens from multiple chains,
   * but each event occurs on a specific chain.
   *
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

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
   *
   * For reference and verification.
   * Also used to link related events (TRADE_IN + TRADE_OUT + TRADE_FEES).
   */
  txHash: string;

  /**
   * Database token ID involved in this event
   *
   * References the Token.id in the database.
   */
  tokenId: string;

  /**
   * On-chain token address (EIP-55 checksummed for EVM)
   *
   * Stored for reference and verification.
   */
  tokenAddress: string;

  /**
   * Token price in quote token units at event time
   *
   * Obtained from external price service (not from pool).
   * Used for calculating tokenValue, deltaCostBasis, and deltaPnl.
   *
   * Expressed as: quote token units per 1 whole token.
   *
   * @example
   * // WETH price: 2000 USDC per 1 WETH
   * // USDC has 6 decimals, WETH has 18 decimals
   * // Price for 1 whole WETH in smallest USDC units:
   * tokenPriceInQuote = 2000_000000n
   */
  tokenPriceInQuote: bigint;

  /**
   * Token balance after this event
   *
   * The holding's balance for this token after the event is processed.
   * In smallest token units.
   */
  balanceAfter: bigint;

  /**
   * Cost basis for this token after this event
   *
   * The holding's cost basis for this token after the event is processed.
   * In quote token's smallest units.
   */
  costBasisAfter: bigint;
}
