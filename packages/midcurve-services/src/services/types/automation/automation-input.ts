/**
 * Automation Input Types
 *
 * Input types for Automation service layer operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type {
  AutomationContractConfig,
  CloseOrderType,
  CloseOrderStatus,
  TriggerMode,
} from '@midcurve/shared';

// =============================================================================
// CLOSE ORDER INPUT TYPES
// =============================================================================

/**
 * Input type for registering a new close order
 *
 * In the shared contract model, orders are registered on-chain first,
 * then notified to the API with closeId and registrationTxHash.
 */
export interface RegisterCloseOrderInput {
  /**
   * Close order type (protocol)
   */
  closeOrderType: CloseOrderType;

  /**
   * Automation contract configuration (immutable at registration time)
   * Contains shared contract address used for this order
   */
  automationContractConfig: AutomationContractConfig;

  /**
   * Position ID to close when triggered
   */
  positionId: string;

  /**
   * Close ID from the on-chain registration (returned by registerClose())
   */
  closeId: number;

  /**
   * NFT ID (token ID from NFPM)
   */
  nftId: bigint;

  /**
   * Pool address
   */
  poolAddress: string;

  /**
   * Trigger mode (LOWER, UPPER, or BOTH)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format)
   * Required if triggerMode is LOWER or BOTH
   */
  sqrtPriceX96Lower?: bigint;

  /**
   * Upper price threshold (sqrtPriceX96 format)
   * Required if triggerMode is UPPER or BOTH
   */
  sqrtPriceX96Upper?: bigint;

  /**
   * Lower price display string (human-readable, for UI)
   */
  priceLowerDisplay?: string;

  /**
   * Upper price display string (human-readable, for UI)
   */
  priceUpperDisplay?: string;

  /**
   * Address to receive closed position tokens
   */
  payoutAddress: string;

  /**
   * Operator address (user's automation wallet)
   */
  operatorAddress: string;

  /**
   * Order expiration
   */
  validUntil: Date;

  /**
   * Maximum slippage in basis points (e.g., 50 = 0.5%)
   */
  slippageBps: number;

  /**
   * Registration transaction hash (from on-chain registration)
   */
  registrationTxHash: string;
}

/**
 * Input for updating a close order
 */
export interface UpdateCloseOrderInput {
  /**
   * New lower price threshold
   */
  sqrtPriceX96Lower?: bigint;

  /**
   * New upper price threshold
   */
  sqrtPriceX96Upper?: bigint;

  /**
   * New slippage in basis points
   */
  slippageBps?: number;
}

/**
 * Options for finding close orders
 */
export interface FindCloseOrderOptions {
  /**
   * Filter by close order type (protocol)
   */
  closeOrderType?: CloseOrderType;

  /**
   * Filter by status
   */
  status?: CloseOrderStatus | CloseOrderStatus[];

  /**
   * Filter by position ID
   */
  positionId?: string;

  /**
   * Filter by pool address
   */
  poolAddress?: string;

  /**
   * Filter by chain ID (via automationContractConfig)
   */
  chainId?: number;
}

/**
 * Input for marking order as registered (on-chain confirmed)
 */
export interface MarkOrderRegisteredInput {
  /**
   * Close ID from the contract
   */
  closeId: number;

  /**
   * Registration transaction hash
   */
  registrationTxHash: string;
}

/**
 * Input for marking order as triggered
 */
export interface MarkOrderTriggeredInput {
  /**
   * Price that triggered the order (sqrtPriceX96)
   */
  triggerSqrtPriceX96: bigint;
}

/**
 * Input for marking order as executed
 */
export interface MarkOrderExecutedInput {
  /**
   * Execution transaction hash
   */
  executionTxHash: string;

  /**
   * Fee charged in basis points
   */
  executionFeeBps: number;

  /**
   * Amount of token0 received
   */
  amount0Out: bigint;

  /**
   * Amount of token1 received
   */
  amount1Out: bigint;
}

// =============================================================================
// POOL SUBSCRIPTION INPUT TYPES
// =============================================================================

/**
 * Input for creating/updating a pool subscription
 */
export interface UpdatePoolSubscriptionInput {
  /**
   * Pool ID (from Pool table)
   */
  poolId: string;

  /**
   * Whether subscription is active
   */
  isActive?: boolean;

  /**
   * Number of active orders for this pool
   */
  activeOrderCount?: number;

  /**
   * Last known sqrtPriceX96
   */
  lastSqrtPriceX96?: bigint;

  /**
   * Last known tick
   */
  lastTick?: number;
}

/**
 * Options for finding pool subscriptions
 */
export interface FindPoolSubscriptionOptions {
  /**
   * Filter by active status
   */
  isActive?: boolean;

  /**
   * Filter by having active orders
   */
  hasActiveOrders?: boolean;
}

// =============================================================================
// AUTOMATION LOG INPUT TYPES
// =============================================================================

/**
 * Platform type for log context
 */
export type AutomationPlatform = 'evm' | 'solana';

/**
 * Base context for all automation log entries
 */
export interface BaseLogContext {
  /**
   * Platform identifier for multi-chain support
   */
  platform?: AutomationPlatform;
}

/**
 * EVM-specific context fields
 */
export interface EvmLogContext extends BaseLogContext {
  platform?: 'evm';
  chainId?: number;
  txHash?: string;
  gasLimit?: string;
  gasPrice?: string;
  gasUsed?: string;
  operatorAddress?: string;
}

/**
 * Solana-specific context fields (future)
 */
export interface SolanaLogContext extends BaseLogContext {
  platform: 'solana';
  signature?: string;
  slot?: number;
  computeUnits?: number;
}

/**
 * Context for ORDER_CREATED event
 */
export interface OrderCreatedContext extends EvmLogContext {
  triggerLowerPrice?: string;
  triggerUpperPrice?: string;
  slippageBps?: number;
}

/**
 * Context for ORDER_TRIGGERED event
 */
export interface OrderTriggeredContext extends EvmLogContext {
  triggerSide: 'lower' | 'upper';
  triggerPrice: string;
  currentPrice: string;
  humanTriggerPrice: string;
  humanCurrentPrice: string;
}

/**
 * Context for ORDER_EXECUTING event
 */
export interface OrderExecutingContext extends EvmLogContext {
  // txHash, gasLimit, gasPrice, operatorAddress from EvmLogContext
}

/**
 * Context for ORDER_EXECUTED event
 */
export interface OrderExecutedContext extends EvmLogContext {
  // txHash, gasUsed from EvmLogContext
  amount0Out: string;
  amount1Out: string;
  executionFeeBps: number;
}

/**
 * Context for ORDER_FAILED event
 */
export interface OrderFailedContext extends EvmLogContext {
  error: string;
  retryCount: number;
  maxRetries: number;
  willRetry: boolean;
}

/**
 * Context for ORDER_CANCELLED event
 */
export interface OrderCancelledContext extends EvmLogContext {
  cancelledBy?: string;
  reason?: string;
}

/**
 * Union type for all context types
 */
export type AutomationLogContext =
  | BaseLogContext
  | EvmLogContext
  | SolanaLogContext
  | OrderCreatedContext
  | OrderTriggeredContext
  | OrderExecutingContext
  | OrderExecutedContext
  | OrderFailedContext
  | OrderCancelledContext;

/**
 * Input for creating an automation log entry
 */
export interface CreateAutomationLogInput {
  /**
   * Position ID (logs are scoped to positions)
   */
  positionId: string;

  /**
   * Optional close order ID (for order-specific logs)
   */
  closeOrderId?: string;

  /**
   * Log level (0=DEBUG, 1=INFO, 2=WARN, 3=ERROR)
   */
  level: number;

  /**
   * Log type (ORDER_CREATED, ORDER_TRIGGERED, etc.)
   */
  logType: string;

  /**
   * User-facing message
   */
  message: string;

  /**
   * Platform-independent context (JSON)
   */
  context?: AutomationLogContext;
}

/**
 * Options for listing automation logs
 */
export interface ListAutomationLogsOptions {
  /**
   * Filter by log level
   */
  level?: number;

  /**
   * Maximum number of logs to return
   */
  limit?: number;

  /**
   * Cursor for pagination (log ID to start after)
   */
  cursor?: string;
}
