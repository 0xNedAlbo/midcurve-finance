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
 * Close order status values
 */
export const CLOSE_ORDER_STATUSES = [
  'pending',
  'registering',
  'active',
  'triggering',
  'executed',
  'cancelled',
  'expired',
  'failed',
] as const;
export type CloseOrderStatus = (typeof CLOSE_ORDER_STATUSES)[number];

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
 * Monitoring state values (off-chain execution lifecycle)
 */
export const MONITORING_STATES = ['idle', 'monitoring', 'triggered', 'suspended'] as const;
export type MonitoringState = (typeof MONITORING_STATES)[number];

/**
 * Serialized close order for API responses.
 *
 * Contains generic fields (protocol, status, config, state) plus
 * protocol-specific fields extracted from JSON for backward compatibility.
 */
export interface SerializedCloseOrder {
  id: string;
  protocol: string;
  closeOrderHash: string | null;
  closeOrderType: CloseOrderType;
  status: CloseOrderStatus;
  monitoringState: MonitoringState;
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
