/**
 * Automation Close Order Endpoint Types
 *
 * Types for managing close orders (register, update, cancel, list).
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
export const TRIGGER_MODES = ['LOWER', 'UPPER', 'BOTH'] as const;
export type TriggerMode = (typeof TRIGGER_MODES)[number];

/**
 * Serialized close order for API responses
 */
export interface SerializedCloseOrder {
  id: string;
  contractId: string;
  orderType: CloseOrderType;
  status: CloseOrderStatus;
  positionId: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialized UniswapV3 close order config (for typed responses)
 */
export interface SerializedUniswapV3CloseOrderConfig {
  closeId: number;
  nftId: string; // bigint as string
  poolAddress: string;
  triggerMode: TriggerMode;
  sqrtPriceX96Lower: string; // bigint as string
  sqrtPriceX96Upper: string; // bigint as string
  payoutAddress: string;
  operatorAddress: string;
  validUntil: string; // ISO date string
  slippageBps: number;
}

/**
 * Serialized UniswapV3 close order state (for typed responses)
 */
export interface SerializedUniswapV3CloseOrderState {
  registrationTxHash: string | null;
  registeredAt: string | null;
  triggeredAt: string | null;
  triggerSqrtPriceX96: string | null; // bigint as string
  executionTxHash: string | null;
  executedAt: string | null;
  executionFeeBps: number | null;
  executionError: string | null;
  retryCount: number;
  amount0Out: string | null; // bigint as string
  amount1Out: string | null; // bigint as string
}

// =============================================================================
// REGISTER CLOSE ORDER
// =============================================================================

/**
 * POST /api/v1/automation/close-orders - Request body
 *
 * Register a new close order for a position.
 */
export interface RegisterCloseOrderRequest {
  /**
   * Order type (protocol)
   */
  orderType: CloseOrderType;

  /**
   * Position ID to close when triggered
   */
  positionId: string;

  /**
   * Trigger mode (LOWER, UPPER, or BOTH)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format as string)
   * Required if triggerMode is LOWER or BOTH
   */
  sqrtPriceX96Lower?: string;

  /**
   * Upper price threshold (sqrtPriceX96 format as string)
   * Required if triggerMode is UPPER or BOTH
   */
  sqrtPriceX96Upper?: string;

  /**
   * Address to receive closed position tokens
   * Defaults to position owner
   */
  payoutAddress?: string;

  /**
   * Order expiration (ISO date string)
   * Defaults to 30 days from now
   */
  validUntil?: string;

  /**
   * Maximum slippage in basis points (e.g., 50 = 0.5%)
   * Defaults to 100 (1%)
   */
  slippageBps?: number;
}

/**
 * Zod schema for register close order request
 */
export const RegisterCloseOrderRequestSchema = z
  .object({
    orderType: z.enum(CLOSE_ORDER_TYPES, {
      errorMap: () => ({ message: `Order type must be one of: ${CLOSE_ORDER_TYPES.join(', ')}` }),
    }),

    positionId: z
      .string()
      .min(1, 'Position ID is required'),

    triggerMode: z.enum(TRIGGER_MODES, {
      errorMap: () => ({ message: `Trigger mode must be one of: ${TRIGGER_MODES.join(', ')}` }),
    }),

    sqrtPriceX96Lower: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Lower must be a valid bigint string')
      .optional(),

    sqrtPriceX96Upper: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Upper must be a valid bigint string')
      .optional(),

    payoutAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
      .optional(),

    validUntil: z
      .string()
      .datetime({ message: 'validUntil must be a valid ISO date string' })
      .optional(),

    slippageBps: z
      .number()
      .int('Slippage must be an integer')
      .min(0, 'Slippage cannot be negative')
      .max(10000, 'Slippage cannot exceed 100%')
      .optional()
      .default(100),
  })
  .refine(
    (data) => {
      if (data.triggerMode === 'LOWER' || data.triggerMode === 'BOTH') {
        return !!data.sqrtPriceX96Lower;
      }
      return true;
    },
    { message: 'sqrtPriceX96Lower is required for LOWER or BOTH trigger modes', path: ['sqrtPriceX96Lower'] }
  )
  .refine(
    (data) => {
      if (data.triggerMode === 'UPPER' || data.triggerMode === 'BOTH') {
        return !!data.sqrtPriceX96Upper;
      }
      return true;
    },
    { message: 'sqrtPriceX96Upper is required for UPPER or BOTH trigger modes', path: ['sqrtPriceX96Upper'] }
  );

/**
 * Inferred type from schema
 */
export type RegisterCloseOrderInput = z.infer<typeof RegisterCloseOrderRequestSchema>;

/**
 * Register close order response (async operation - returns 202)
 */
export interface RegisterCloseOrderResponseData {
  /**
   * Close order ID
   */
  id: string;

  /**
   * Order type
   */
  orderType: CloseOrderType;

  /**
   * Position ID
   */
  positionId: string;

  /**
   * Operation status
   */
  operationStatus: 'pending' | 'registering' | 'completed' | 'failed';

  /**
   * URL to poll for status
   */
  pollUrl: string;
}

/**
 * POST /api/v1/automation/close-orders - Response
 */
export type RegisterCloseOrderResponse = ApiResponse<RegisterCloseOrderResponseData>;

// =============================================================================
// LIST CLOSE ORDERS
// =============================================================================

/**
 * GET /api/v1/automation/close-orders - Query parameters
 */
export interface ListCloseOrdersRequest {
  /**
   * Filter by order type (optional)
   */
  orderType?: CloseOrderType;

  /**
   * Filter by status (optional)
   */
  status?: CloseOrderStatus;

  /**
   * Filter by position ID (optional)
   */
  positionId?: string;

  /**
   * Filter by contract ID (optional)
   */
  contractId?: string;
}

/**
 * Zod schema for list close orders query
 */
export const ListCloseOrdersQuerySchema = z.object({
  orderType: z.enum(CLOSE_ORDER_TYPES).optional(),
  status: z.enum(CLOSE_ORDER_STATUSES).optional(),
  positionId: z.string().optional(),
  contractId: z.string().optional(),
});

/**
 * Inferred type from schema
 */
export type ListCloseOrdersInput = z.infer<typeof ListCloseOrdersQuerySchema>;

/**
 * GET /api/v1/automation/close-orders - Response
 */
export type ListCloseOrdersResponse = ApiResponse<SerializedCloseOrder[]>;

// =============================================================================
// GET CLOSE ORDER
// =============================================================================

/**
 * GET /api/v1/automation/close-orders/[id] - Response
 */
export type GetCloseOrderResponse = ApiResponse<SerializedCloseOrder>;

// =============================================================================
// UPDATE CLOSE ORDER
// =============================================================================

/**
 * PUT /api/v1/automation/close-orders/[id] - Request body
 *
 * Update an existing close order (requires on-chain transaction).
 */
export interface UpdateCloseOrderRequest {
  /**
   * New lower price threshold (sqrtPriceX96 format as string)
   */
  sqrtPriceX96Lower?: string;

  /**
   * New upper price threshold (sqrtPriceX96 format as string)
   */
  sqrtPriceX96Upper?: string;

  /**
   * New slippage in basis points
   */
  slippageBps?: number;
}

/**
 * Zod schema for update close order request
 */
export const UpdateCloseOrderRequestSchema = z
  .object({
    sqrtPriceX96Lower: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Lower must be a valid bigint string')
      .optional(),

    sqrtPriceX96Upper: z
      .string()
      .regex(/^\d+$/, 'sqrtPriceX96Upper must be a valid bigint string')
      .optional(),

    slippageBps: z
      .number()
      .int('Slippage must be an integer')
      .min(0, 'Slippage cannot be negative')
      .max(10000, 'Slippage cannot exceed 100%')
      .optional(),
  })
  .refine(
    (data) => data.sqrtPriceX96Lower || data.sqrtPriceX96Upper || data.slippageBps !== undefined,
    { message: 'At least one field must be provided for update' }
  );

/**
 * Inferred type from schema
 */
export type UpdateCloseOrderInput = z.infer<typeof UpdateCloseOrderRequestSchema>;

/**
 * PUT /api/v1/automation/close-orders/[id] - Response
 */
export type UpdateCloseOrderResponse = ApiResponse<SerializedCloseOrder>;

// =============================================================================
// CANCEL CLOSE ORDER
// =============================================================================

/**
 * DELETE /api/v1/automation/close-orders/[id] - Response
 */
export type CancelCloseOrderResponse = ApiResponse<SerializedCloseOrder>;

// =============================================================================
// GET CLOSE ORDER STATUS (Polling)
// =============================================================================

/**
 * Close order registration status for polling
 */
export interface CloseOrderRegistrationStatus {
  id: string;
  orderType: CloseOrderType;
  positionId: string;
  operationStatus: 'pending' | 'registering' | 'completed' | 'failed';
  operationError?: string;
  order?: SerializedCloseOrder;
}

/**
 * GET /api/v1/automation/close-orders/[id]/status - Response
 */
export type GetCloseOrderStatusResponse = ApiResponse<CloseOrderRegistrationStatus>;
