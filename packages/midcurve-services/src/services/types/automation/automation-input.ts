/**
 * Automation Input Types
 *
 * Input types for Automation service layer operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 *
 * NOTE: Close order input types have been moved to close-order-input.ts.
 * This file retains pool subscription and automation log types.
 */

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

// =============================================================================
// ORDER LOG CONTEXT TYPES
// =============================================================================

/**
 * Base context for order-related events
 *
 * All order log contexts should extend this interface to include
 * the human-readable order tag for identification in log messages.
 */
export interface OrderLogContext extends EvmLogContext {
  /**
   * Human-readable order identifier
   *
   * Format: "{DIRECTION}@{PRICE}" e.g., "TP@3300.34" or "SL@1450.12"
   * - Direction: "TP" (Take Profit / upper) or "SL" (Stop Loss / lower)
   * - Price: Trigger price in quote tokens, formatted with formatCompactValue()
   *
   * Generated using generateOrderTag() from utils/automation/order-tag.ts
   */
  orderTag: string;
}

/**
 * Context for ORDER_CREATED event
 *
 * @messageTemplate "[{orderTag}] Close order created"
 */
export interface OrderCreatedContext extends OrderLogContext {
  triggerLowerPrice?: string;
  triggerUpperPrice?: string;
  slippageBps?: number;
}

/**
 * Context for ORDER_REGISTERED event
 *
 * @messageTemplate "[{orderTag}] Order registered on-chain (tx: {registrationTxHash[0:10]}...)"
 */
export interface OrderRegisteredContext extends OrderLogContext {
  registrationTxHash: string;
}

/**
 * Context for ORDER_TRIGGERED event
 *
 * @messageTemplate "[{orderTag}] Price crossed trigger ({humanTriggerPrice} -> {humanCurrentPrice})"
 */
export interface OrderTriggeredContext extends OrderLogContext {
  triggerSide: 'lower' | 'upper';
  triggerPrice: string;
  currentPrice: string;
  humanTriggerPrice: string;
  humanCurrentPrice: string;
}

/**
 * Context for ORDER_EXECUTING event
 *
 * @messageTemplate "[{orderTag}] Executing close transaction (tx: {txHash[0:10]}...)"
 */
export interface OrderExecutingContext extends OrderLogContext {
  // txHash, gasLimit, gasPrice, operatorAddress from EvmLogContext
}

/**
 * Context for ORDER_EXECUTED event
 *
 * @messageTemplate "[{orderTag}] Position closed successfully (tx: {txHash[0:10]}...)"
 */
export interface OrderExecutedContext extends OrderLogContext {
  // txHash, gasUsed from EvmLogContext
  amount0Out: string;
  amount1Out: string;
  executionFeeBps: number;
}

/**
 * Context for ORDER_FAILED event
 *
 * @messageTemplate "[{orderTag}] Execution failed: {error}. Retry {retryCount + 1}/{maxRetries} scheduled."
 * @messageTemplate "[{orderTag}] Execution failed: {error}. No more retries."
 */
export interface OrderFailedContext extends OrderLogContext {
  error: string;
  retryCount: number;
  maxRetries: number;
  willRetry: boolean;
  /** Delay in milliseconds before retry (if willRetry is true) */
  retryDelayMs?: number;
  /** ISO timestamp when retry is scheduled (if willRetry is true) */
  scheduledRetryAt?: string;
}

/**
 * Context for RETRY_SCHEDULED event
 *
 * @messageTemplate "[{orderTag}] Retrying execution (attempt {retryCount + 1}/{maxRetries}) after {delaySeconds}s delay"
 * @messageTemplate "[{orderTag}] Retrying execution (attempt {retryCount + 1}/{maxRetries})"
 */
export interface RetryScheduledContext extends OrderLogContext {
  error: string;
  retryCount: number;
  maxRetries: number;
  retryDelayMs?: number;
  scheduledRetryAt?: string;
}

/**
 * Context for PREFLIGHT_VALIDATION event
 *
 * @messageTemplate "[{orderTag}] Pre-flight validation passed (liquidity: {liquidity})"
 * @messageTemplate "[{orderTag}] Pre-flight validation failed: {reason}"
 */
export interface PreflightValidationContext extends OrderLogContext {
  isValid: boolean;
  reason?: string;
  liquidity?: string;
  token0?: string;
  token1?: string;
  tickLower?: number;
  tickUpper?: number;
  tokensOwed0?: string;
  tokensOwed1?: string;
  owner?: string;
  isApproved?: boolean;
  isApprovedForAll?: boolean;
}

/**
 * Context for SIMULATION_FAILED event
 *
 * @messageTemplate "[{orderTag}] Transaction simulation failed: {decodedError || 'unknown error'}"
 */
export interface SimulationFailedContext extends OrderLogContext {
  error: string;
  nftId: string;
  triggerMode: number;
  contractAddress: string;
  feeRecipient: string;
  feeBps: number;
  decodedError?: string;
  contractBalances?: {
    token0Symbol: string;
    token0Balance: string;
    token1Symbol: string;
    token1Balance: string;
  };
}

/**
 * Context for ORDER_CANCELLED event
 *
 * @messageTemplate "[{orderTag}] Close order cancelled by user"
 */
export interface OrderCancelledContext extends OrderLogContext {
  cancelledBy?: string;
  reason?: string;
}

/**
 * Context for ORDER_EXPIRED event
 *
 * @messageTemplate "[{orderTag}] Close order expired (valid until {validUntil})"
 */
export interface OrderExpiredContext extends OrderLogContext {
  /** ISO timestamp when the order expired */
  validUntil: string;
}

/**
 * Context for ORDER_MODIFIED event
 *
 * @messageTemplate "[{orderTag}] Close order modified: {changes}"
 */
export interface OrderModifiedContext extends OrderLogContext {
  /** Human-readable description of changes */
  changes: string;
  previousTriggerPrice?: string;
  newTriggerPrice?: string;
  previousSlippageBps?: number;
  newSlippageBps?: number;
}

/**
 * Union type for all context types
 */
export type AutomationLogContext =
  | BaseLogContext
  | EvmLogContext
  | SolanaLogContext
  | OrderLogContext
  | OrderCreatedContext
  | OrderRegisteredContext
  | OrderTriggeredContext
  | OrderExecutingContext
  | OrderExecutedContext
  | OrderFailedContext
  | RetryScheduledContext
  | OrderCancelledContext
  | OrderExpiredContext
  | OrderModifiedContext
  | PreflightValidationContext
  | SimulationFailedContext;

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
