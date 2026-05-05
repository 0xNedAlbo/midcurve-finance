/**
 * GET /api/v1/positions/uniswapv3-staking/:chainId/:vaultAddress
 *
 * Fetches a specific UniswapV3 staking-vault position owned by the
 * authenticated user. Vaults are owner-bound 1:1 (per SPEC-0003b §2),
 * so the vault address alone disambiguates — no separate owner segment.
 */

import type { UniswapV3StakingPositionResponse } from './typed-response.js';
import { z } from 'zod';

/** Path parameters for fetching a specific UniswapV3 staking-vault position. */
export interface GetUniswapV3StakingPositionParams {
  /** EVM chain ID (e.g., 42161 for Arbitrum). */
  chainId: string;
  /** Vault contract address (EIP-55 checksummed). */
  vaultAddress: string;
}

/** Success response for GET. Returns the complete staking-vault position. */
export type GetUniswapV3StakingPositionResponse = UniswapV3StakingPositionResponse;

// =============================================================================
// Zod schema
// =============================================================================

export const GetUniswapV3StakingPositionParamsSchema = z.object({
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

export type GetUniswapV3StakingPositionParamsInput = z.input<
  typeof GetUniswapV3StakingPositionParamsSchema
>;
export type GetUniswapV3StakingPositionParamsOutput = z.output<
  typeof GetUniswapV3StakingPositionParamsSchema
>;
