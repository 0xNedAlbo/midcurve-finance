/**
 * Notification Services
 *
 * Barrel export for notification-related services, adapters, and events.
 */

// Core CRUD service (used by API routes and DbNotificationAdapter)
export {
  NotificationService,
  type NotificationServiceDependencies,
  type ListNotificationsResult,
} from './notification-service.js';

// User-facing notification service (dispatch to adapters)
export {
  UserNotificationService,
  type UserNotificationServiceDependencies,
  type NotifyRangeChangeParams,
  type NotifyExecutionSuccessParams,
  type NotifyExecutionFailedParams,
} from './user-notification-service.js';

// Webhook config service
export {
  WebhookConfigService,
  type WebhookConfigServiceDependencies,
} from './webhook-config-service.js';

// Webhook delivery service
export {
  WebhookDeliveryService,
  type WebhookDeliveryServiceDependencies,
  type WebhookDeliveryResult,
} from './webhook-delivery-service.js';

// Position range tracker service
export {
  PositionRangeTrackerService,
  type PositionRangeTrackerServiceDependencies,
  type RangeCheckResult,
} from './position-range-tracker-service.js';

// Adapters
export type { NotificationAdapter } from './adapters/index.js';
export {
  DbNotificationAdapter,
  type DbNotificationAdapterDependencies,
  WebhookNotificationAdapter,
  type WebhookNotificationAdapterDependencies,
} from './adapters/index.js';

// Event types
export type {
  NotificationEvent,
  NotificationEventTypeFromEvent,
  PositionOutOfRangeEvent,
  PositionInRangeEvent,
  StopLossExecutedEvent,
  StopLossFailedEvent,
  TakeProfitExecutedEvent,
  TakeProfitFailedEvent,
} from './events/index.js';
export {
  isRangeEvent,
  isExecutionSuccessEvent,
  isExecutionFailedEvent,
  isOrderEvent,
} from './events/index.js';

// Formatters
export {
  formatNotification,
  type TokenSymbols,
  type FormattedNotification,
  formatSqrtPriceX96,
  formatTickAsPrice,
  formatAmount,
  serializePositionForWebhook,
  serializeCloseOrderForWebhook,
} from './formatters/index.js';
