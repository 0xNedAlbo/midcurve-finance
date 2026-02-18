/**
 * Notification Event Types
 *
 * Slim, structured event objects used internally by the notification system.
 * Each event carries minimal data (IDs + raw numerics). Adapters are
 * responsible for enrichment (fetching position data, formatting prices, etc.).
 */

// =============================================================================
// BASE
// =============================================================================

/** Fields present on all notification events */
interface BaseNotificationEvent {
  userId: string;
  positionId: string;
  timestamp: Date;
}

// =============================================================================
// RANGE EVENTS
// =============================================================================

/** Position went out of range */
export interface PositionOutOfRangeEvent extends BaseNotificationEvent {
  type: 'POSITION_OUT_OF_RANGE';
  poolId: string;
  poolAddress: string;
  chainId: number;
  currentTick: number;
  currentSqrtPriceX96: string;
  tickLower: number;
  tickUpper: number;
}

/** Position came back in range */
export interface PositionInRangeEvent extends BaseNotificationEvent {
  type: 'POSITION_IN_RANGE';
  poolId: string;
  poolAddress: string;
  chainId: number;
  currentTick: number;
  currentSqrtPriceX96: string;
  tickLower: number;
  tickUpper: number;
}

// =============================================================================
// EXECUTION EVENTS
// =============================================================================

/** Stop loss executed successfully */
export interface StopLossExecutedEvent extends BaseNotificationEvent {
  type: 'STOP_LOSS_EXECUTED';
  orderId: string;
  chainId: number;
  txHash: string;
  amount0Out: string;
  amount1Out: string;
  triggerSqrtPriceX96: string;
  executionSqrtPriceX96: string;
}

/** Stop loss failed permanently */
export interface StopLossFailedEvent extends BaseNotificationEvent {
  type: 'STOP_LOSS_FAILED';
  orderId: string;
  chainId: number;
  triggerSqrtPriceX96: string;
  error: string;
  retryCount: number;
}

/** Take profit executed successfully */
export interface TakeProfitExecutedEvent extends BaseNotificationEvent {
  type: 'TAKE_PROFIT_EXECUTED';
  orderId: string;
  chainId: number;
  txHash: string;
  amount0Out: string;
  amount1Out: string;
  triggerSqrtPriceX96: string;
  executionSqrtPriceX96: string;
}

/** Take profit failed permanently */
export interface TakeProfitFailedEvent extends BaseNotificationEvent {
  type: 'TAKE_PROFIT_FAILED';
  orderId: string;
  chainId: number;
  triggerSqrtPriceX96: string;
  error: string;
  retryCount: number;
}

// =============================================================================
// UNION TYPE
// =============================================================================

/** Discriminated union of all notification events */
export type NotificationEvent =
  | PositionOutOfRangeEvent
  | PositionInRangeEvent
  | StopLossExecutedEvent
  | StopLossFailedEvent
  | TakeProfitExecutedEvent
  | TakeProfitFailedEvent;

/** Extract the event type string from the union */
export type NotificationEventTypeFromEvent = NotificationEvent['type'];

// =============================================================================
// TYPE GUARDS
// =============================================================================

/** Check if event is a range event */
export function isRangeEvent(
  event: NotificationEvent
): event is PositionOutOfRangeEvent | PositionInRangeEvent {
  return event.type === 'POSITION_OUT_OF_RANGE' || event.type === 'POSITION_IN_RANGE';
}

/** Check if event is an execution success event */
export function isExecutionSuccessEvent(
  event: NotificationEvent
): event is StopLossExecutedEvent | TakeProfitExecutedEvent {
  return event.type === 'STOP_LOSS_EXECUTED' || event.type === 'TAKE_PROFIT_EXECUTED';
}

/** Check if event is an execution failure event */
export function isExecutionFailedEvent(
  event: NotificationEvent
): event is StopLossFailedEvent | TakeProfitFailedEvent {
  return event.type === 'STOP_LOSS_FAILED' || event.type === 'TAKE_PROFIT_FAILED';
}

/** Check if event has an orderId */
export function isOrderEvent(
  event: NotificationEvent
): event is StopLossExecutedEvent | StopLossFailedEvent | TakeProfitExecutedEvent | TakeProfitFailedEvent {
  return 'orderId' in event;
}
