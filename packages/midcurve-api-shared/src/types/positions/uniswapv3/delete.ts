/**
 * DELETE /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Deletes a specific Uniswap V3 position owned by the authenticated user.
 * Idempotent - returns success even if the position doesn't exist.
 */

import { z } from 'zod';

/**
 * Path parameters for deleting a specific Uniswap V3 position
 */
export interface DeleteUniswapV3PositionParams {
  /** EVM chain ID (e.g., 1 for Ethereum mainnet) */
  chainId: string;
  /** Uniswap V3 NFT token ID (positive integer) */
  nftId: string;
}

/**
 * Success response for DELETE /api/v1/positions/uniswapv3/:chainId/:nftId
 *
 * Returns an empty data object on successful deletion (or if position didn't exist).
 * The endpoint is idempotent.
 */
export interface DeleteUniswapV3PositionResponse {
  /** Empty object indicating successful deletion */
  [key: string]: never;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Zod schema for validating path parameters of DELETE /api/v1/positions/uniswapv3/:chainId/:nftId
 */
export const DeleteUniswapV3PositionParamsSchema = z.object({
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
   * Uniswap V3 NFT token ID as a string (will be coerced to number)
   * Must be a valid positive integer
   */
  nftId: z.string().transform((val, ctx) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'nftId must be a valid positive integer',
      });
      return z.NEVER;
    }
    return parsed;
  }),
});

export type DeleteUniswapV3PositionParamsInput = z.input<
  typeof DeleteUniswapV3PositionParamsSchema
>;
export type DeleteUniswapV3PositionParamsOutput = z.output<
  typeof DeleteUniswapV3PositionParamsSchema
>;
