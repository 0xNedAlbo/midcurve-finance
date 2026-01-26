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
export const TRIGGER_MODES = ['LOWER', 'UPPER'] as const;
export type TriggerMode = (typeof TRIGGER_MODES)[number];

/**
 * Swap direction values for post-close swap
 * Uses Uniswap's native token ordering (token0/token1), role-agnostic.
 */
export const SWAP_DIRECTIONS = ['TOKEN0_TO_1', 'TOKEN1_TO_0'] as const;
export type SwapDirection = (typeof SWAP_DIRECTIONS)[number];

/**
 * Swap configuration for post-close token swap via Paraswap
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
 * Automation contract configuration stored per-order
 */
export interface SerializedAutomationContractConfig {
  chainId: number;
  contractAddress: string;
  positionManager: string;
}

/**
 * Serialized close order for API responses
 */
export interface SerializedCloseOrder {
  id: string;
  closeOrderHash: string | null;
  closeOrderType: CloseOrderType;
  status: CloseOrderStatus;
  positionId: string;
  automationContractConfig: SerializedAutomationContractConfig;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
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
 * Register a close order after on-chain registration.
 * In the shared contract model, the user signs registerClose() on-chain first,
 * then calls this endpoint to notify the API.
 */
export interface RegisterCloseOrderRequest {
  /**
   * Close order type (protocol)
   */
  closeOrderType: CloseOrderType;

  /**
   * Position ID to close when triggered
   */
  positionId: string;

  /**
   * Automation contract configuration (immutable at registration)
   */
  automationContractConfig: {
    chainId: number;
    contractAddress: string;
    positionManager: string;
  };

  /**
   * On-chain close ID from registerClose() transaction
   */
  closeId: number;

  /**
   * NFT ID of the position (bigint as string)
   */
  nftId: string;

  /**
   * Pool address
   */
  poolAddress: string;

  /**
   * Operator address (user's autowallet)
   */
  operatorAddress: string;

  /**
   * Trigger mode (LOWER or UPPER)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format as string)
   * Required if triggerMode is LOWER
   */
  sqrtPriceX96Lower?: string;

  /**
   * Upper price threshold (sqrtPriceX96 format as string)
   * Required if triggerMode is UPPER
   */
  sqrtPriceX96Upper?: string;

  /**
   * Address to receive closed position tokens
   */
  payoutAddress: string;

  /**
   * Order expiration (ISO date string)
   */
  validUntil: string;

  /**
   * Maximum slippage in basis points (e.g., 50 = 0.5%)
   */
  slippageBps: number;

  /**
   * Registration transaction hash
   */
  registrationTxHash: string;

  /**
   * Optional swap configuration for post-close token swap via Paraswap
   */
  swapConfig?: SwapConfig;
}

/**
 * Zod schema for register close order request
 */
export const RegisterCloseOrderRequestSchema = z
  .object({
    closeOrderType: z.enum(CLOSE_ORDER_TYPES, {
      errorMap: () => ({ message: `Close order type must be one of: ${CLOSE_ORDER_TYPES.join(', ')}` }),
    }),

    positionId: z.string().min(1, 'Position ID is required'),

    automationContractConfig: z.object({
      chainId: z.number().int().positive('Chain ID must be a positive integer'),
      contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
      positionManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid position manager address'),
    }),

    closeId: z.number().int().nonnegative('Close ID must be a non-negative integer'),

    nftId: z.string().regex(/^\d+$/, 'NFT ID must be a valid bigint string'),

    poolAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid pool address'),

    operatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid operator address'),

    triggerMode: z.enum(TRIGGER_MODES, {
      errorMap: () => ({ message: `Trigger mode must be one of: ${TRIGGER_MODES.join(', ')}` }),
    }),

    sqrtPriceX96Lower: z.string().regex(/^\d+$/, 'sqrtPriceX96Lower must be a valid bigint string').optional(),

    sqrtPriceX96Upper: z.string().regex(/^\d+$/, 'sqrtPriceX96Upper must be a valid bigint string').optional(),

    payoutAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid payout address'),

    validUntil: z.string().datetime({ message: 'validUntil must be a valid ISO date string' }),

    slippageBps: z.number().int().min(0).max(10000, 'Slippage cannot exceed 100%'),

    registrationTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),

    swapConfig: z
      .object({
        enabled: z.boolean(),
        direction: z.enum(SWAP_DIRECTIONS, {
          errorMap: () => ({ message: `Swap direction must be one of: ${SWAP_DIRECTIONS.join(', ')}` }),
        }),
        slippageBps: z.number().int().min(0).max(10000, 'Swap slippage cannot exceed 100%'),
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.triggerMode === 'LOWER') {
        return !!data.sqrtPriceX96Lower;
      }
      return true;
    },
    { message: 'sqrtPriceX96Lower is required for LOWER trigger mode', path: ['sqrtPriceX96Lower'] }
  )
  .refine(
    (data) => {
      if (data.triggerMode === 'UPPER') {
        return !!data.sqrtPriceX96Upper;
      }
      return true;
    },
    { message: 'sqrtPriceX96Upper is required for UPPER trigger mode', path: ['sqrtPriceX96Upper'] }
  );

/**
 * Inferred type from schema
 */
export type RegisterCloseOrderInput = z.infer<typeof RegisterCloseOrderRequestSchema>;

/**
 * POST /api/v1/automation/close-orders - Response
 *
 * Returns the created close order (201 Created).
 */
export type RegisterCloseOrderResponse = ApiResponse<SerializedCloseOrder>;

// =============================================================================
// LIST CLOSE ORDERS
// =============================================================================

/**
 * GET /api/v1/automation/close-orders - Query parameters
 */
export interface ListCloseOrdersRequest {
  /**
   * Filter by close order type (optional)
   */
  closeOrderType?: CloseOrderType;

  /**
   * Filter by status (optional)
   */
  status?: CloseOrderStatus;

  /**
   * Filter by position ID (optional)
   */
  positionId?: string;
}

/**
 * Zod schema for list close orders query
 */
export const ListCloseOrdersQuerySchema = z.object({
  closeOrderType: z.enum(CLOSE_ORDER_TYPES).optional(),
  status: z.enum(CLOSE_ORDER_STATUSES).optional(),
  positionId: z.string().optional(),
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
  closeOrderType: CloseOrderType;
  positionId: string;
  operationStatus: 'pending' | 'registering' | 'completed' | 'failed';
  operationError?: string;
  order?: SerializedCloseOrder;
}

/**
 * GET /api/v1/automation/close-orders/[id]/status - Response
 */
export type GetCloseOrderStatusResponse = ApiResponse<CloseOrderRegistrationStatus>;

// =============================================================================
// NOTIFY ORDER CANCELLED (User Signs On-Chain)
// =============================================================================

/**
 * POST /api/v1/automation/close-orders/[id]/cancelled - Request body
 *
 * Notify the API after user cancels a close order on-chain.
 */
export interface NotifyOrderCancelledRequest {
  /**
   * Transaction hash of the cancellation
   */
  txHash: string;
}

/**
 * Zod schema for notify order cancelled request
 */
export const NotifyOrderCancelledRequestSchema = z.object({
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
});

/**
 * Inferred type from schema
 */
export type NotifyOrderCancelledInput = z.infer<typeof NotifyOrderCancelledRequestSchema>;

/**
 * POST /api/v1/automation/close-orders/[id]/cancelled - Response
 */
export type NotifyOrderCancelledResponse = ApiResponse<SerializedCloseOrder>;
