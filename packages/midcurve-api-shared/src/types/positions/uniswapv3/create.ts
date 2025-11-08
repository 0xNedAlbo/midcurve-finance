/**
 * Position Create Endpoint Types
 *
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId}
 *
 * Allows users to manually create a position from their transaction receipt
 * after sending an INCREASE_LIQUIDITY transaction on-chain.
 *
 * Uses shared types from @midcurve/shared with bigint → string conversion for JSON.
 */

import type { ApiResponse, BigIntToString } from '../../common/index.js';
import type { UniswapV3Position } from '@midcurve/shared';
import { z } from 'zod';

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request body
 *
 * The user provides data from their transaction receipt after creating a position on-chain.
 * This endpoint creates the position in the database and calculates PnL from the ledger event.
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
   * This is the address that sent the INCREASE_LIQUIDITY transaction (msg.sender)
   *
   * @example "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
   */
  ownerAddress: string;

  /**
   * OPTIONAL: Address of the quote token (the token used as unit of account)
   *
   * If provided:
   * - Will be validated and normalized to EIP-55 checksum format
   * - Must match either token0 or token1 in the pool
   * - Service will use this address to determine isToken0Quote
   *
   * If omitted:
   * - Quote token will be determined automatically using QuoteTokenService
   * - Respects user preferences → chain defaults → token0 fallback
   *
   * @example "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" (USDC)
   */
  quoteTokenAddress?: string;

  /**
   * INCREASE_LIQUIDITY event data from the transaction receipt
   *
   * This event is emitted by the NonfungiblePositionManager contract when
   * liquidity is added to a position. All data is available in the transaction receipt.
   */
  increaseEvent: {
    /**
     * Block timestamp when the event occurred
     * ISO 8601 date string
     *
     * @example "2025-01-15T10:30:00Z"
     */
    timestamp: string;

    /**
     * Block number where the event occurred
     * bigint as string
     *
     * @example "12345678"
     */
    blockNumber: string;

    /**
     * Transaction index within the block
     * Used for event ordering
     *
     * @example 42
     */
    transactionIndex: number;

    /**
     * Log index within the transaction
     * Used for event ordering
     *
     * @example 5
     */
    logIndex: number;

    /**
     * Transaction hash
     * For reference and verification
     *
     * @example "0x1234567890abcdef..."
     */
    transactionHash: string;

    /**
     * Amount of liquidity added
     * bigint as string
     * This value comes directly from the INCREASE_LIQUIDITY event data
     *
     * @example "1000000000000000000"
     */
    liquidity: string;

    /**
     * Amount of token0 deposited
     * bigint as string (in smallest token units)
     * This value comes directly from the INCREASE_LIQUIDITY event data
     *
     * @example "500000000" (500 USDC with 6 decimals)
     */
    amount0: string;

    /**
     * Amount of token1 deposited
     * bigint as string (in smallest token units)
     * This value comes directly from the INCREASE_LIQUIDITY event data
     *
     * @example "250000000000000000" (0.25 WETH with 18 decimals)
     */
    amount1: string;
  };
}

/**
 * Position data for API response
 *
 * Based on UniswapV3Position from @midcurve/shared with:
 * - bigint fields converted to strings (for JSON serialization)
 * - Date fields converted to ISO 8601 strings
 * - Fully nested pool and token objects (no separate ID fields)
 */
export type CreateUniswapV3PositionData = BigIntToString<UniswapV3Position>;

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
 * Transaction hash validation regex
 * Matches hex hashes with or without 0x prefix
 */
const txHashRegex = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * BigInt string validation regex
 * Matches numeric strings (no scientific notation)
 */
const bigIntStringRegex = /^[0-9]+$/;

/**
 * PUT /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request validation
 *
 * Validates the request body for creating a position from user-provided event data.
 *
 * Position state fields are derived from the event data:
 * - liquidity = increaseEvent.liquidity
 * - ownerAddress = user-provided
 * - feeGrowthInside0LastX128 = 0 (new position)
 * - feeGrowthInside1LastX128 = 0 (new position)
 * - tokensOwed0 = 0 (new position)
 * - tokensOwed1 = 0 (new position)
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

  // Optional: Quote Token Selection
  quoteTokenAddress: z
    .string()
    .regex(ethereumAddressRegex, 'Quote token address must be a valid Ethereum address')
    .optional(),

  // INCREASE_LIQUIDITY Event Data
  increaseEvent: z.object({
    timestamp: z
      .string()
      .datetime({ message: 'Timestamp must be a valid ISO 8601 date string' }),

    blockNumber: z
      .string()
      .regex(bigIntStringRegex, 'Block number must be a numeric string'),

    transactionIndex: z
      .number()
      .int('Transaction index must be an integer')
      .nonnegative('Transaction index must be non-negative'),

    logIndex: z
      .number()
      .int('Log index must be an integer')
      .nonnegative('Log index must be non-negative'),

    transactionHash: z
      .string()
      .regex(txHashRegex, 'Transaction hash must be a valid hex string'),

    liquidity: z
      .string()
      .regex(bigIntStringRegex, 'Liquidity must be a numeric string'),

    amount0: z
      .string()
      .regex(bigIntStringRegex, 'Amount0 must be a numeric string'),

    amount1: z
      .string()
      .regex(bigIntStringRegex, 'Amount1 must be a numeric string'),
  }),
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
