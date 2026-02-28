/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Fetches a specific Uniswap V3 position owned by the authenticated user
 * and refreshes its state from on-chain data.
 */

import type { UniswapV3PositionResponse } from './typed-response.js';
import type { SerializedCloseOrder } from '../../automation/close-orders.js';
import { z } from 'zod';

/**
 * Path parameters for fetching a specific Uniswap V3 position
 */
export interface GetUniswapV3PositionParams {
  /** EVM chain ID (e.g., 1 for Ethereum mainnet) */
  chainId: string;
  /** Uniswap V3 NFT token ID */
  nftId: string;
}

/**
 * Success response for GET /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Returns the complete position data with all bigint fields converted to strings for JSON serialization.
 * The position state is refreshed from on-chain data before being returned.
 * Includes active close orders (status: active | triggering) for the position.
 *
 * PnL curve data is available separately via GET /api/v1/positions/:positionId/pnl-curve.
 */
export interface GetUniswapV3PositionResponse extends UniswapV3PositionResponse {
  activeCloseOrders: SerializedCloseOrder[];
  isTrackedInAccounting: boolean;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Zod schema for validating path parameters of GET /api/v1/positions/uniswapv3/:chainId/:nftId
 */
export const GetUniswapV3PositionParamsSchema = z.object({
  /**
   * EVM chain ID as a string (will be coerced to number)
   * Must be a valid positive integer
   */
  chainId: z.string().transform((val, ctx) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'chainId must be a valid positive integer',
      });
      return z.NEVER;
    }
    return parsed;
  }),

  /**
   * Uniswap V3 NFT token ID
   * Must be a non-empty string representing a valid token ID
   */
  nftId: z.string().min(1, 'nftId must not be empty'),
});

export type GetUniswapV3PositionParamsInput = z.input<
  typeof GetUniswapV3PositionParamsSchema
>;
export type GetUniswapV3PositionParamsOutput = z.output<
  typeof GetUniswapV3PositionParamsSchema
>;
