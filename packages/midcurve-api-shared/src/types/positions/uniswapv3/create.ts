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
 * The user provides position configuration data after minting a position on-chain.
 * All data is available from the UI wizard state and the mint transaction receipt.
 */
export interface CreateUniswapV3PositionRequest {
  /**
   * Pool address on the blockchain
   * EIP-55 checksummed address
   *
   * @example "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" (USDC/WETH on Ethereum)
   */
  poolAddress: string;

  /**
   * Upper tick bound of the position's price range
   * @example 201120
   */
  tickUpper: number;

  /**
   * Lower tick bound of the position's price range
   * @example 199120
   */
  tickLower: number;

  /**
   * Owner address (wallet that owns the NFT)
   * EIP-55 checksummed address
   * This is the address that sent the mint transaction (msg.sender)
   *
   * @example "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
   */
  ownerAddress: string;

  /**
   * Whether token0 is the quote token (unit of account)
   * Determined by the UI based on user selection or token role comparison
   *
   * @example true (token0 is quote token, e.g., USDC in USDC/WETH pool)
   */
  isToken0Quote: boolean;

  /**
   * Initial liquidity amount from the mint transaction
   * bigint as string - extracted from IncreaseLiquidity event in tx receipt
   *
   * @example "1000000000000000000"
   */
  liquidity: string;
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
 * Ethereum address validation regex
 * Matches hex addresses with or without 0x prefix
 */
const ethereumAddressRegex = /^(0x)?[0-9a-fA-F]{40}$/;

/**
 * BigInt string validation regex
 * Matches numeric strings (no scientific notation)
 */
const bigIntStringRegex = /^[0-9]+$/;

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request validation
 *
 * Validates the request body for creating a position record.
 * Position is created with default state values; historical ledger events
 * are fetched asynchronously by a business rule.
 */
export const CreateUniswapV3PositionRequestSchema = z.object({
  // Position Config
  poolAddress: z
    .string()
    .regex(ethereumAddressRegex, 'Pool address must be a valid Ethereum address'),

  tickUpper: z
    .number()
    .int('Tick upper must be an integer'),

  tickLower: z
    .number()
    .int('Tick lower must be an integer'),

  // Owner
  ownerAddress: z
    .string()
    .regex(ethereumAddressRegex, 'Owner address must be a valid Ethereum address'),

  // Quote token selection (determined by UI)
  isToken0Quote: z.boolean(),

  // Initial liquidity from mint transaction
  liquidity: z
    .string()
    .regex(bigIntStringRegex, 'Liquidity must be a numeric string'),
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
