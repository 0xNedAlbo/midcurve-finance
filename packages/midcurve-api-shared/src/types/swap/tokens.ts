/**
 * Swap Token Types
 *
 * Types for swap token representations used across the swap UI.
 */

import type { ApiResponse } from '../common/index.js';

/**
 * Local chain ID for development/testing
 */
export const LOCAL_CHAIN_ID = 31337;

/**
 * Token available for swapping
 */
export interface SwapToken {
  /**
   * Token contract address (EIP-55 checksummed)
   */
  address: string;

  /**
   * Token symbol (e.g., "WETH", "USDC")
   */
  symbol: string;

  /**
   * Token name (e.g., "Wrapped Ether", "USD Coin")
   */
  name: string;

  /**
   * Token decimals
   */
  decimals: number;

  /**
   * Token logo URL
   */
  logoUrl?: string;
}

/**
 * GET /api/v1/swap/tokens - Response data
 */
export type GetSwapTokensData = SwapToken[];

/**
 * GET /api/v1/swap/tokens - Response
 */
export interface GetSwapTokensResponse extends ApiResponse<GetSwapTokensData> {
  meta?: {
    chainId: number;
    count: number;
    timestamp: string;
    cached: boolean;
  };
}
