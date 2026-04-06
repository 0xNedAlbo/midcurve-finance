/**
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Fetches a specific UniswapV3 vault position owned by the authenticated user
 * and refreshes its state from on-chain data.
 */

import type { UniswapV3VaultPositionResponse } from './typed-response.js';
import { z } from 'zod';

/**
 * Path parameters for fetching a specific UniswapV3 vault position
 */
export interface GetUniswapV3VaultPositionParams {
  /** EVM chain ID (e.g., 42161 for Arbitrum) */
  chainId: string;
  /** Vault contract address (EIP-55 checksummed) */
  vaultAddress: string;
}

/**
 * Success response for GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Returns the complete vault position data with all bigint fields converted to strings.
 * No close orders — automation is not supported for vault positions in v1.
 */
export interface GetUniswapV3VaultPositionResponse extends UniswapV3VaultPositionResponse {
  isTrackedInAccounting: boolean;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Zod schema for validating path parameters
 */
export const GetUniswapV3VaultPositionParamsSchema = z.object({
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

  vaultAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'vaultAddress must be a valid EVM address'),
});

export type GetUniswapV3VaultPositionParamsInput = z.input<
  typeof GetUniswapV3VaultPositionParamsSchema
>;
export type GetUniswapV3VaultPositionParamsOutput = z.output<
  typeof GetUniswapV3VaultPositionParamsSchema
>;
