/**
 * Position Create Endpoint Types
 *
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId}
 *
 * Creates a position record in the database after the user mints a position on-chain.
 * The position is created with default values; a business rule will fetch historical
 * ledger events asynchronously via the position.created domain event.
 *
 * Uses typed response types for full type safety in UI components.
 */

import type { ApiResponse } from '../../common/index.js';
import type { UniswapV3PositionResponse } from './typed-response.js';
import { z } from 'zod';

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request body
 *
 * Called by the UI after a successful on-chain mint. The backend calls discover()
 * which reads real on-chain state, imports full ledger history, and creates the
 * position record if it doesn't exist yet.
 */
export interface CreateUniswapV3PositionRequest {
  /**
   * Address of the quote token (unit of account), as selected by the user in the wizard.
   * Passed directly to discover() to override auto-detection.
   * EIP-55 checksummed address.
   *
   * @example "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" (USDC on Ethereum)
   */
  quoteTokenAddress: string;
}

/**
 * Position data for API response
 *
 * Based on UniswapV3Position from @midcurve/shared with:
 * - bigint fields converted to strings (for JSON serialization)
 * - Date fields converted to ISO 8601 strings
 * - Fully nested pool and token objects (no separate ID fields)
 */
export type CreateUniswapV3PositionData = UniswapV3PositionResponse;

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Response
 */
export type CreateUniswapV3PositionResponse = ApiResponse<CreateUniswapV3PositionData>;

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request validation
 */
export const CreateUniswapV3PositionRequestSchema = z.object({
  quoteTokenAddress: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{40}$/, 'Quote token address must be a valid Ethereum address'),
});

/**
 * Path parameters validation
 *
 * Validates chainId and nftId from URL path.
 * Reuses schema from get.schema.ts for consistency.
 */
export const CreateUniswapV3PositionParamsSchema = z.object({
  chainId: z
    .string()
    .regex(/^[0-9]+$/, 'Chain ID must be a numeric string')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, { message: 'Chain ID must be positive' }),

  nftId: z
    .string()
    .regex(/^[0-9]+$/, 'NFT ID must be a numeric string')
    .transform((val) => parseInt(val, 10))
    .refine((val) => val > 0, { message: 'NFT ID must be positive' }),
});
