/**
 * Pool Price Endpoint Types
 *
 * Lightweight endpoint for fetching current pool price data.
 * Returns only sqrtPriceX96 and currentTick for fast price checks.
 *
 * GET /api/pools/uniswapv3/:chainId/:poolAddress/pool-price
 */

/**
 * Get Pool Price Request
 *
 * Parameters extracted from URL path:
 * - chainId: Chain ID (e.g., "1" for Ethereum)
 * - poolAddress: Pool contract address (EIP-55 checksummed)
 */
export interface GetPoolPriceRequest {
  chainId: string;
  poolAddress: string;
}

/**
 * Get Pool Price Response
 *
 * Current pool price data from slot0.
 * Optimized for frequent refresh operations.
 */
export interface GetPoolPriceResponse {
  /**
   * Square root price encoded as X96 fixed-point number
   * String representation of bigint for JSON serialization
   */
  sqrtPriceX96: string;

  /**
   * Current tick of the pool
   * Logarithmic price representation (log₁.₀₀₀₁ of price)
   */
  currentTick: number;

  /**
   * Timestamp when the price was fetched from blockchain
   * ISO 8601 format
   */
  timestamp: string;
}

/**
 * Get Pool Price Error Response
 */
export interface GetPoolPriceError {
  /**
   * Error code
   * - INVALID_CHAIN: Chain ID not supported
   * - INVALID_ADDRESS: Pool address format invalid
   * - POOL_NOT_FOUND: Pool contract doesn't exist or is not UniswapV3
   * - RPC_ERROR: Blockchain RPC call failed
   */
  code: 'INVALID_CHAIN' | 'INVALID_ADDRESS' | 'POOL_NOT_FOUND' | 'RPC_ERROR';

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Optional additional error details for debugging
   */
  details?: unknown;
}
