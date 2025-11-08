/**
 * Position Import Endpoint Types
 *
 * Uses shared types from @midcurve/shared with bigint → string conversion for JSON.
 */

import type { ApiResponse, BigIntToString } from '../../common/index.js';
import type { UniswapV3Position } from '@midcurve/shared';
import { z } from 'zod';

/**
 * POST /api/v1/positions/uniswapv3/import - Request body
 */
export interface ImportUniswapV3PositionRequest {
  /**
   * EVM chain ID where the position exists
   * @example 1 (Ethereum), 42161 (Arbitrum), 8453 (Base)
   */
  chainId: number;

  /**
   * Uniswap V3 NFT token ID
   * Each Uniswap V3 position is represented by an NFT in the NonfungiblePositionManager contract
   * @example 123456
   */
  nftId: number;
}

/**
 * Position data for API response
 *
 * Based on UniswapV3Position from @midcurve/shared with:
 * - bigint fields converted to strings (for JSON serialization)
 * - Date fields converted to ISO 8601 strings
 * - Fully nested pool and token objects (no separate ID fields)
 *
 * Example structure:
 * {
 *   id: "uuid",
 *   protocol: "uniswapv3",
 *   currentValue: "1500000000", // bigint as string
 *   pool: {
 *     id: "uuid",
 *     token0: { id: "uuid", symbol: "USDC", ... },
 *     token1: { id: "uuid", symbol: "WETH", ... },
 *     ...
 *   },
 *   config: { chainId: 1, nftId: 123456, ... },
 *   state: { liquidity: "...", ... },
 *   ...
 * }
 */
export type ImportUniswapV3PositionData = BigIntToString<UniswapV3Position>;

/**
 * POST /api/v1/positions/uniswapv3/import - Response
 */
export type ImportUniswapV3PositionResponse = ApiResponse<ImportUniswapV3PositionData>;

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * POST /api/v1/positions/uniswapv3/import - Request validation
 *
 * Validates:
 * - chainId: Positive integer (1 for Ethereum, 42161 for Arbitrum, etc.)
 * - nftId: Positive integer (Uniswap V3 NFT token ID)
 *
 * Quote token is NOT included - it's automatically determined by the service
 * using QuoteTokenService (respects user preferences → chain defaults → token0 fallback)
 */
export const ImportUniswapV3PositionRequestSchema = z.object({
  chainId: z
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
  nftId: z
    .number()
    .int('NFT ID must be an integer')
    .positive('NFT ID must be positive'),
});
