/**
 * Uniswap V3 Ledger Event Configuration
 *
 * Immutable metadata for a position event on Uniswap V3.
 * Contains blockchain ordering information and liquidity/fee state at event time.
 */

// ============================================================================
// CONFIG INTERFACE
// ============================================================================

/**
 * UniswapV3LedgerEventConfig
 *
 * Configuration for a Uniswap V3 ledger event.
 */
export interface UniswapV3LedgerEventConfig {
  /** EVM chain ID where event occurred */
  chainId: number;

  /** NFT token ID of the position */
  nftId: bigint;

  /** Block number where event occurred */
  blockNumber: bigint;

  /** Transaction index within the block */
  txIndex: number;

  /** Log index within the transaction */
  logIndex: number;

  /** Transaction hash */
  txHash: string;

  /** Block hash (for reorg detection) */
  blockHash: string;

  /** Change in liquidity (delta L) */
  deltaL: bigint;

  /** Total liquidity after this event */
  liquidityAfter: bigint;

  /** Fees collected in token0 (for COLLECT events) */
  feesCollected0: bigint;

  /** Fees collected in token1 (for COLLECT events) */
  feesCollected1: bigint;

  /** Uncollected principal in token0 after this event */
  uncollectedPrincipal0After: bigint;

  /** Uncollected principal in token1 after this event */
  uncollectedPrincipal1After: bigint;

  /** Pool price at event time (sqrtPriceX96) */
  sqrtPriceX96: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

/**
 * UniswapV3LedgerEventConfigJSON
 *
 * JSON representation with bigint as string.
 */
export interface UniswapV3LedgerEventConfigJSON {
  chainId: number;
  nftId: string;
  blockNumber: string;
  txIndex: number;
  logIndex: number;
  txHash: string;
  blockHash: string;
  deltaL: string;
  liquidityAfter: string;
  feesCollected0: string;
  feesCollected1: string;
  uncollectedPrincipal0After: string;
  uncollectedPrincipal1After: string;
  sqrtPriceX96: string;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

/**
 * Convert config to JSON for API responses.
 */
export function ledgerEventConfigToJSON(
  config: UniswapV3LedgerEventConfig
): UniswapV3LedgerEventConfigJSON {
  return {
    chainId: config.chainId,
    nftId: config.nftId.toString(),
    blockNumber: config.blockNumber.toString(),
    txIndex: config.txIndex,
    logIndex: config.logIndex,
    txHash: config.txHash,
    blockHash: config.blockHash,
    deltaL: config.deltaL.toString(),
    liquidityAfter: config.liquidityAfter.toString(),
    feesCollected0: config.feesCollected0.toString(),
    feesCollected1: config.feesCollected1.toString(),
    uncollectedPrincipal0After: config.uncollectedPrincipal0After.toString(),
    uncollectedPrincipal1After: config.uncollectedPrincipal1After.toString(),
    sqrtPriceX96: config.sqrtPriceX96.toString(),
  };
}

/**
 * Create config from JSON (database or API input).
 */
export function ledgerEventConfigFromJSON(
  json: UniswapV3LedgerEventConfigJSON
): UniswapV3LedgerEventConfig {
  return {
    chainId: json.chainId,
    nftId: BigInt(json.nftId),
    blockNumber: BigInt(json.blockNumber),
    txIndex: json.txIndex,
    logIndex: json.logIndex,
    txHash: json.txHash,
    blockHash: json.blockHash,
    deltaL: BigInt(json.deltaL),
    liquidityAfter: BigInt(json.liquidityAfter),
    feesCollected0: BigInt(json.feesCollected0),
    feesCollected1: BigInt(json.feesCollected1),
    uncollectedPrincipal0After: BigInt(json.uncollectedPrincipal0After),
    uncollectedPrincipal1After: BigInt(json.uncollectedPrincipal1After),
    sqrtPriceX96: BigInt(json.sqrtPriceX96),
  };
}
