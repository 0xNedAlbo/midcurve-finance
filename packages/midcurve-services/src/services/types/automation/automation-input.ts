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
  SwapConfig,
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
   * Trigger mode (LOWER or UPPER)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format)
   * Required if triggerMode is LOWER
   */
  sqrtPriceX96Lower?: bigint;

  /**
   * Upper price threshold (sqrtPriceX96 format)
   * Required if triggerMode is UPPER
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
   * Optional swap configuration for post-close swap via Paraswap
   */
  swapConfig?: SwapConfig;

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

/**
 * Input for creating a close order from an on-chain registration event.
 * Used when the order was registered directly on-chain (not via the UI/API flow).
 */
export interface CreateFromOnChainEventInput {
  /**
   * Position ID in the database
   */
  positionId: string;

  /**
   * Automation contract configuration
   */
  automationContractConfig: AutomationContractConfig;

  /**
   * NFT ID (token ID from NFPM) as string
   */
  nftId: string;

  /**
   * Pool address
   */
  poolAddress: string;

  /**
   * Trigger mode (LOWER or UPPER)
   */
  triggerMode: TriggerMode;

  /**
   * Trigger tick from the on-chain event
   */
  triggerTick: number;

  /**
   * Position owner address
   */
  owner: string;

  /**
   * Operator address (automation wallet)
   */
  operator: string;

  /**
   * Payout address (receives closed position tokens)
   */
  payout: string;

  /**
   * Valid until (unix timestamp as string from contract event)
   */
  validUntil: string;

  /**
   * Slippage tolerance in basis points
   */
  slippageBps: number;

  /**
   * Swap direction from on-chain event
   */
  swapDirection: 'NONE' | 'TOKEN0_TO_1' | 'TOKEN1_TO_0';

  /**
   * Swap slippage in basis points
   */
  swapSlippageBps: number;

  /**
   * Registration transaction hash
   */
  registrationTxHash: string;

  /**
   * Block number where the registration occurred
   */
  blockNumber: string;
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
  closeId: number;
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
