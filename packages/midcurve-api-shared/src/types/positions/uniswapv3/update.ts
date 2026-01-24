/**
 * Position Update Endpoint Types
 *
 * PATCH /api/v1/positions/uniswapv3/{chainId}/{nftId}
 *
 * Allows authenticated users to append new events to their position's ledger
 * after executing on-chain transactions (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, COLLECT).
 *
 * Uses shared types from @midcurve/shared with bigint → string conversion for JSON.
 */

import type { ApiResponse } from '../../common/index.js';
import type { UniswapV3PositionResponse } from './typed-response.js';
import { z } from 'zod';

/**
 * Event type for Uniswap V3 position events
 *
 * Maps to on-chain NonfungiblePositionManager contract events:
 * - INCREASE_LIQUIDITY: IncreaseLiquidity event
 * - DECREASE_LIQUIDITY: DecreaseLiquidity event
 * - COLLECT: Collect event
 */
export type UniswapV3EventType = 'INCREASE_LIQUIDITY' | 'DECREASE_LIQUIDITY' | 'COLLECT';

/**
 * User-provided event data from transaction receipt
 *
 * This represents raw event data from the NonfungiblePositionManager contract.
 * The service layer will calculate all financial fields (poolPrice, costBasis, PnL).
 */
export interface UpdateUniswapV3PositionEvent {
  /**
   * Event type from the transaction receipt
   * @example "INCREASE_LIQUIDITY"
   */
  eventType: UniswapV3EventType;

  /**
   * Block timestamp when the event occurred
   * ISO 8601 date string
   *
   * @example "2024-01-20T15:30:00.000Z"
   */
  timestamp: string;

  /**
   * Block number where the event occurred
   * bigint as string
   *
   * @example "175500000"
   */
  blockNumber: string;

  /**
   * Transaction index within the block
   * Used for event ordering
   *
   * @example 50
   */
  transactionIndex: number;

  /**
   * Log index within the transaction
   * Used for event ordering
   *
   * @example 3
   */
  logIndex: number;

  /**
   * Transaction hash
   * For reference and duplicate detection
   *
   * @example "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
   */
  transactionHash: string;

  /**
   * Liquidity delta (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY only)
   * bigint as string
   * REQUIRED for INCREASE_LIQUIDITY and DECREASE_LIQUIDITY
   * MUST be omitted or "0" for COLLECT
   *
   * @example "500000000000000000"
   */
  liquidity?: string;

  /**
   * Amount of token0 in the event
   * bigint as string (in smallest token units)
   *
   * For INCREASE/DECREASE: amount deposited/withdrawn
   * For COLLECT: amount collected (fees + principal)
   *
   * @example "250000000"
   */
  amount0: string;

  /**
   * Amount of token1 in the event
   * bigint as string (in smallest token units)
   *
   * For INCREASE/DECREASE: amount deposited/withdrawn
   * For COLLECT: amount collected (fees + principal)
   *
   * @example "125000000000000000"
   */
  amount1: string;

  /**
   * Recipient address (COLLECT only)
   * EIP-55 checksummed address
   * REQUIRED for COLLECT events
   * MUST be omitted for INCREASE_LIQUIDITY and DECREASE_LIQUIDITY
   *
   * @example "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0"
   */
  recipient?: string;
}

/**
 * PATCH /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request body
 *
 * Array of events to append to the position's ledger.
 * Events must be chronologically AFTER existing events (blockNumber → txIndex → logIndex).
 */
export interface UpdateUniswapV3PositionRequest {
  /**
   * Array of events to add to the position
   * Events will be sorted and processed in blockchain order
   * Must all come AFTER existing events in the ledger
   *
   * @minItems 1
   */
  events: UpdateUniswapV3PositionEvent[];
}

/**
 * Position data for API response
 *
 * Uses the strongly-typed UniswapV3PositionResponse for full type safety
 * with typed config/state fields.
 */
export type UpdateUniswapV3PositionData = UniswapV3PositionResponse;

/**
 * PATCH /api/v1/positions/uniswapv3/{chainId}/{nftId} - Response
 *
 * Returns the fully updated position with refreshed on-chain state
 * and recalculated financial fields.
 */
export type UpdateUniswapV3PositionResponse = ApiResponse<UpdateUniswapV3PositionData>;

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
 * Matches hex hashes with or without 0x prefix (64 hex chars)
 */
const txHashRegex = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * BigInt string validation regex
 * Matches numeric strings (no scientific notation, no decimals)
 */
const bigIntStringRegex = /^[0-9]+$/;

/**
 * Event type validation
 */
const eventTypeSchema = z.enum(['INCREASE_LIQUIDITY', 'DECREASE_LIQUIDITY', 'COLLECT'], {
  errorMap: () => ({
    message: 'Event type must be INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, or COLLECT',
  }),
});

/**
 * Single event validation
 *
 * Validates individual event data with conditional field requirements:
 * - INCREASE_LIQUIDITY: requires liquidity, forbids recipient
 * - DECREASE_LIQUIDITY: requires liquidity, forbids recipient
 * - COLLECT: requires recipient, forbids/ignores liquidity
 */
const eventSchema = z
  .object({
    eventType: eventTypeSchema,

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
      .regex(txHashRegex, 'Transaction hash must be a valid 64-character hex string'),

    liquidity: z
      .string()
      .regex(bigIntStringRegex, 'Liquidity must be a numeric string')
      .optional(),

    amount0: z
      .string()
      .regex(bigIntStringRegex, 'Amount0 must be a numeric string'),

    amount1: z
      .string()
      .regex(bigIntStringRegex, 'Amount1 must be a numeric string'),

    recipient: z
      .string()
      .regex(ethereumAddressRegex, 'Recipient must be a valid Ethereum address')
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Validate INCREASE_LIQUIDITY and DECREASE_LIQUIDITY events
    if (data.eventType === 'INCREASE_LIQUIDITY' || data.eventType === 'DECREASE_LIQUIDITY') {
      // Must have liquidity
      if (!data.liquidity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['liquidity'],
          message: `Liquidity is required for ${data.eventType} events`,
        });
      }

      // Must not have recipient
      if (data.recipient) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipient'],
          message: `Recipient is not allowed for ${data.eventType} events (only for COLLECT)`,
        });
      }
    }

    // Validate COLLECT events
    if (data.eventType === 'COLLECT') {
      // Must have recipient
      if (!data.recipient) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipient'],
          message: 'Recipient is required for COLLECT events',
        });
      }
    }
  });

/**
 * PATCH /api/v1/positions/uniswapv3/{chainId}/{nftId} - Request validation
 *
 * Validates the request body for updating a position with new events.
 */
export const UpdateUniswapV3PositionRequestSchema = z.object({
  events: z
    .array(eventSchema)
    .min(1, 'At least one event is required')
    .max(100, 'Maximum 100 events allowed per request'),
});

/**
 * Path parameters validation
 *
 * Validates chainId and nftId from URL path.
 * Reuses same validation logic as GET/PUT/DELETE endpoints.
 */
export const UpdateUniswapV3PositionParamsSchema = z.object({
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
