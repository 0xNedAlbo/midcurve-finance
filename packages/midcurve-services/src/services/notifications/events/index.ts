/**
 * Notification Events
 *
 * Barrel export for notification event types.
 */

export type {
  NotificationEvent,
  NotificationEventTypeFromEvent,
  PositionOutOfRangeEvent,
  PositionInRangeEvent,
  StopLossExecutedEvent,
  StopLossFailedEvent,
  TakeProfitExecutedEvent,
  TakeProfitFailedEvent,
} from './notification-events.js';

export {
  isRangeEvent,
  isExecutionSuccessEvent,
  isExecutionFailedEvent,
  isOrderEvent,
} from './notification-events.js';
