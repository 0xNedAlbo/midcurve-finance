/**
 * Notification Services
 *
 * Barrel export for notification-related services, adapters, and events.
 */

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

// Adapters
export type { NotificationAdapter } from './adapters/index.js';
export {
  UiNotificationAdapter,
  type UiNotificationAdapterDependencies,
  WebhookNotificationAdapter,
  type WebhookNotificationAdapterDependencies,
  type WebhookDeliveryResult,
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
