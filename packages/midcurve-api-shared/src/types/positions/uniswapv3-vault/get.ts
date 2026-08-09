/**
 * GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress
 *
 * Fetches a specific UniswapV3 vault position owned by the authenticated user
 * and refreshes its state from on-chain data.
 */

import type { UniswapV3VaultPositionResponse } from './typed-response.js';
import type { SerializedCloseOrder } from '../../automation/close-orders.js';
import { normalizeAddress } from '@midcurve/shared';
import { z } from 'zod';

/**
 * Path parameters for fetching a specific UniswapV3 vault position
 */
export interface GetUniswapV3VaultPositionParams {
  /** EVM chain ID (e.g., 42161 for Arbitrum) */
  chainId: string;
  /** Vault contract address (EIP-55 checksummed) */
  vaultAddress: string;
  /** Owner wallet address (EIP-55 checksummed) */
  ownerAddress: string;
}

/**
 * Success response for GET /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress
 *
 * Returns the complete vault position data with all bigint fields converted to strings.
 * Includes all close orders for the position (all automation states).
 */
export interface GetUniswapV3VaultPositionResponse extends UniswapV3VaultPositionResponse {
  closeOrders: SerializedCloseOrder[];
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Zod schema for validating path parameters.
 *
 * Addresses are normalized to EIP-55 so a lowercase address in the URL — a
 * valid way to write an EVM address, and what most tooling produces —
 * resolves the same position as a checksummed one.
 *
 * Ordering matters: `.regex()` runs before `.transform()`, and its pattern is
 * strictly narrower than the one `normalizeAddress()` validates against. That
 * is what keeps the throw inside the transform unreachable — a throw there
 * would escape as a 500 rather than a 400.
 *
 * This is the outer guard. The inner one is
 * `UniswapV3VaultPosition.createHash()`, which normalizes again for callers
 * that never pass through a schema.
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
    .regex(/^0x[0-9a-fA-F]{40}$/, 'vaultAddress must be a valid EVM address')
    .transform((value) => normalizeAddress(value)),

  ownerAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'ownerAddress must be a valid EVM address')
    .transform((value) => normalizeAddress(value)),
});

export type GetUniswapV3VaultPositionParamsInput = z.input<
  typeof GetUniswapV3VaultPositionParamsSchema
>;
export type GetUniswapV3VaultPositionParamsOutput = z.output<
  typeof GetUniswapV3VaultPositionParamsSchema
>;
