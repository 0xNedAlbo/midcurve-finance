/**
 * Notification Type Definitions
 *
 * Core types for the notification system.
 */

// =============================================================================
// NOTIFICATION EVENT TYPES
// =============================================================================

/**
 * All supported notification event types
 * Must match NotificationEventType enum in Prisma schema
 */
export const NOTIFICATION_EVENT_TYPES = [
  'POSITION_OUT_OF_RANGE',
  'POSITION_IN_RANGE',
  'STOP_LOSS_EXECUTED',
  'STOP_LOSS_FAILED',
  'TAKE_PROFIT_EXECUTED',
  'TAKE_PROFIT_FAILED',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/**
 * Human-readable labels for notification event types
 */
export const NOTIFICATION_EVENT_TYPE_LABELS: Record<
  NotificationEventType,
  string
> = {
  POSITION_OUT_OF_RANGE: 'Position Out of Range',
  POSITION_IN_RANGE: 'Position In Range',
  STOP_LOSS_EXECUTED: 'Stop Loss Executed',
  STOP_LOSS_FAILED: 'Stop Loss Failed',
  TAKE_PROFIT_EXECUTED: 'Take Profit Executed',
  TAKE_PROFIT_FAILED: 'Take Profit Failed',
};

// =============================================================================
// NOTIFICATION PAYLOAD TYPES
// =============================================================================

/**
 * Payload for range change events (POSITION_OUT_OF_RANGE, POSITION_IN_RANGE)
 */
export interface RangeEventPayload {
  poolAddress: string;
  chainId: number;
  currentSqrtPriceX96: string;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  // Human-readable prices (optional, for display)
  humanCurrentPrice?: string;
  humanLowerPrice?: string;
  humanUpperPrice?: string;
}

/**
 * Payload for successful execution events (STOP_LOSS_EXECUTED, TAKE_PROFIT_EXECUTED)
 */
export interface ExecutionSuccessPayload {
  txHash: string;
  chainId: number;
  amount0Out: string;
  amount1Out: string;
  triggerSide: 'lower' | 'upper';
  triggerSqrtPriceX96: string;
  executionSqrtPriceX96: string;
  // Human-readable values (optional, for display)
  humanTriggerPrice?: string;
  humanExecutionPrice?: string;
  humanAmount0Out?: string;
  humanAmount1Out?: string;
}

/**
 * Payload for failed execution events (STOP_LOSS_FAILED, TAKE_PROFIT_FAILED)
 */
export interface ExecutionFailedPayload {
  error: string;
  chainId: number;
  retryCount: number;
  triggerSide: 'lower' | 'upper';
  triggerSqrtPriceX96: string;
  // Human-readable values (optional, for display)
  humanTriggerPrice?: string;
}

/**
 * Union type for all notification payloads
 */
export type NotificationPayload =
  | RangeEventPayload
  | ExecutionSuccessPayload
  | ExecutionFailedPayload;

// =============================================================================
// NOTIFICATION DATA TYPE
// =============================================================================

/**
 * Serialized notification for API responses
 */
export interface NotificationData {
  id: string;
  createdAt: string;
  eventType: NotificationEventType;
  positionId: string | null;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  payload: NotificationPayload;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if an event type is a range event
 */
export function isRangeEvent(eventType: NotificationEventType): boolean {
  return (
    eventType === 'POSITION_OUT_OF_RANGE' || eventType === 'POSITION_IN_RANGE'
  );
}

/**
 * Check if an event type is an execution event
 */
export function isExecutionEvent(eventType: NotificationEventType): boolean {
  return (
    eventType === 'STOP_LOSS_EXECUTED' ||
    eventType === 'STOP_LOSS_FAILED' ||
    eventType === 'TAKE_PROFIT_EXECUTED' ||
    eventType === 'TAKE_PROFIT_FAILED'
  );
}

/**
 * Check if an event type indicates success
 */
export function isSuccessEvent(eventType: NotificationEventType): boolean {
  return (
    eventType === 'POSITION_IN_RANGE' ||
    eventType === 'STOP_LOSS_EXECUTED' ||
    eventType === 'TAKE_PROFIT_EXECUTED'
  );
}

/**
 * Check if an event type indicates failure or warning
 */
export function isWarningEvent(eventType: NotificationEventType): boolean {
  return (
    eventType === 'POSITION_OUT_OF_RANGE' ||
    eventType === 'STOP_LOSS_FAILED' ||
    eventType === 'TAKE_PROFIT_FAILED'
  );
}
