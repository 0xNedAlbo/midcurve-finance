/**
 * Uniswap V3 Pool Price Watch Endpoint Types and Schemas
 *
 * Types and Zod schemas for the database-backed pool price subscription system.
 * Follows the same pattern as ERC-20 balance watch endpoints.
 */

import { z } from 'zod';
import type { ApiResponse } from '../../common/index.js';

// ============================================================================
// Subscription Status
// ============================================================================

export type UniswapV3PoolPriceSubscriptionStatus = 'active' | 'paused' | 'deleted';

// ============================================================================
// Path Parameters
// ============================================================================

/**
 * Zod schema for path params validation.
 */
export const UniswapV3PoolPriceWatchPathParamsSchema = z.object({
  chainId: z.string().regex(/^\d+$/, 'chainId must be a number'),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address format'),
});

export type UniswapV3PoolPriceWatchPathParams = z.infer<typeof UniswapV3PoolPriceWatchPathParamsSchema>;

// ============================================================================
// POST /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch - Create
// ============================================================================

/**
 * Single subscription info returned after creation or poll.
 */
export interface UniswapV3PoolPriceSubscriptionInfo {
  /** Unique subscription ID for polling */
  subscriptionId: string;
  /** URL for polling this subscription */
  pollUrl: string;
  /** Pool contract address (EIP-55 checksummed) */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current sqrtPriceX96 (bigint as string) */
  currentSqrtPriceX96: string;
  /** Current tick */
  currentTick: number;
  /** Subscription status */
  status: UniswapV3PoolPriceSubscriptionStatus;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
}

/**
 * POST response data containing the created subscription.
 */
export interface UniswapV3PoolPriceWatchResponseData {
  subscription: UniswapV3PoolPriceSubscriptionInfo;
}

export type UniswapV3PoolPriceWatchResponse = ApiResponse<UniswapV3PoolPriceWatchResponseData>;

// ============================================================================
// GET /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch/[subscriptionId] - Poll
// ============================================================================

/**
 * GET response data for polling a subscription.
 */
export interface UniswapV3PoolPriceSubscriptionPollResponseData {
  /** Unique subscription ID */
  subscriptionId: string;
  /** Subscription status */
  status: UniswapV3PoolPriceSubscriptionStatus;
  /** Pool contract address (EIP-55 checksummed) */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current sqrtPriceX96 (bigint as string) */
  currentSqrtPriceX96: string;
  /** Current tick */
  currentTick: number;
  /** URL for polling this subscription */
  pollUrl: string;
  /** ISO 8601 timestamp when subscription was created */
  createdAt: string;
  /** ISO 8601 timestamp of last poll */
  lastPolledAt: string;
  /** ISO 8601 timestamp when price last changed */
  lastUpdatedAt: string;
}

export type UniswapV3PoolPriceSubscriptionPollResponse =
  ApiResponse<UniswapV3PoolPriceSubscriptionPollResponseData>;

// ============================================================================
// DELETE /api/v1/pools/uniswapv3/[chainId]/[address]/pool-price/watch/[subscriptionId] - Cancel
// ============================================================================

/**
 * DELETE response data for canceling a subscription.
 */
export interface UniswapV3PoolPriceSubscriptionCancelResponseData {
  /** Subscription ID that was canceled */
  subscriptionId: string;
  /** Final status (always 'deleted') */
  status: 'deleted';
  /** Human-readable message */
  message: string;
}

export type UniswapV3PoolPriceSubscriptionCancelResponse =
  ApiResponse<UniswapV3PoolPriceSubscriptionCancelResponseData>;
