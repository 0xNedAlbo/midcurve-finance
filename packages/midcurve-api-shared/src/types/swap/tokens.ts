/**
 * Swap Token List API Types
 *
 * Types for fetching ParaSwap-supported tokens for a chain.
 * These tokens are guaranteed to be swappable via ParaSwap.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

/**
 * Supported chain IDs for ParaSwap swaps
 * Note: BSC (56) and Polygon (137) are NOT supported
 */
export const PARASWAP_SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 10] as const;
export type ParaswapSupportedChainId = (typeof PARASWAP_SUPPORTED_CHAIN_IDS)[number];

/**
 * Check if a chain ID is supported by ParaSwap
 */
export function isParaswapSupportedChain(chainId: number): chainId is ParaswapSupportedChainId {
  return PARASWAP_SUPPORTED_CHAIN_IDS.includes(chainId as ParaswapSupportedChainId);
}

/**
 * GET /api/v1/swap/tokens - Query params
 */
export interface GetSwapTokensQuery {
  /**
   * EVM chain ID (must be a ParaSwap-supported chain)
   */
  chainId: number;
}

/**
 * GET /api/v1/swap/tokens - Query validation
 */
export const GetSwapTokensQuerySchema = z.object({
  chainId: z.coerce
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive')
    .refine(
      (val) => PARASWAP_SUPPORTED_CHAIN_IDS.includes(val as ParaswapSupportedChainId),
      {
        message: `Chain not supported for swaps. Supported chains: ${PARASWAP_SUPPORTED_CHAIN_IDS.join(', ')}`,
      }
    ),
});

/**
 * Token available for swapping via ParaSwap
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
   * Token logo URL (from ParaSwap or CoinGecko)
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
