/**
 * Automation Close Order Endpoint Types
 *
 * Types for close order API responses (list, get).
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Close order type discriminator values
 */
export const CLOSE_ORDER_TYPES = ['uniswapv3'] as const;
export type CloseOrderType = (typeof CLOSE_ORDER_TYPES)[number];

/**
 * Automation state values — direct mapping from DB, no derivation needed.
 *
 * monitoring: Price monitor is watching for trigger condition
 * executing:  Execution in progress (simulation/signing/broadcasting)
 * retrying:   Execution failed, waiting before retry (60s delay)
 * failed:     Max execution attempts exhausted (terminal)
 *
 * Note: Executed orders are deleted from the DB (execution history lives in AutomationLog).
 */
export const AUTOMATION_STATES = ['monitoring', 'executing', 'retrying', 'failed'] as const;
export type AutomationState = (typeof AUTOMATION_STATES)[number];

/**
 * Trigger mode values
 */
export const TRIGGER_MODES = ['LOWER', 'UPPER'] as const;
export type TriggerMode = (typeof TRIGGER_MODES)[number];

/**
 * Swap direction values for post-close swap
 * Uses Uniswap's native token ordering (token0/token1), role-agnostic.
 */
export const SWAP_DIRECTIONS = ['TOKEN0_TO_1', 'TOKEN1_TO_0'] as const;
export type SwapDirection = (typeof SWAP_DIRECTIONS)[number];

/**
 * Swap configuration for post-close token swap
 */
export interface SwapConfig {
  /**
   * Whether swap is enabled
   */
  enabled: boolean;

  /**
   * Direction of the swap (TOKEN0_TO_1 or TOKEN1_TO_0)
   */
  direction: SwapDirection;

  /**
   * Slippage tolerance in basis points (e.g., 100 = 1%)
   */
  slippageBps: number;
}

/**
 * Serialized close order for API responses.
 *
 * automationState is the single lifecycle field — no derived status needed.
 */
export interface SerializedCloseOrder {
  id: string;
  protocol: string;
  closeOrderHash: string | null;
  closeOrderType: CloseOrderType;
  automationState: AutomationState;
  executionAttempts: number;
  lastError: string | null;
  positionId: string;
  chainId: number;
  nftId: string;
  triggerMode: TriggerMode;
  triggerTick: number | null;
  slippageBps: number | null;
  swapDirection: SwapDirection | null;
  swapSlippageBps: number | null;
  validUntil: string | null;
  payoutAddress: string | null;
  contractAddress: string;
  operatorAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Close order hash format pattern
 * Format: "{sl|tp}@{tick}" where tick is an integer (positive or negative)
 * Examples: "sl@-12345", "tp@201120"
 */
export const CLOSE_ORDER_HASH_PATTERN = /^(sl|tp)@-?\d+$/;

/**
 * Zod schema for validating close order hash
 */
export const CloseOrderHashSchema = z.string().regex(
  CLOSE_ORDER_HASH_PATTERN,
  'Invalid close order hash format. Expected "sl@{tick}" or "tp@{tick}"'
);

// =============================================================================
// LIST CLOSE ORDERS
// =============================================================================

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders - Response
 */
export type ListCloseOrdersResponse = ApiResponse<SerializedCloseOrder[]>;

// =============================================================================
// GET CLOSE ORDER
// =============================================================================

/**
 * GET /api/v1/positions/uniswapv3/:chainId/:nftId/close-orders/:hash - Response
 */
export type GetCloseOrderResponse = ApiResponse<SerializedCloseOrder>;
