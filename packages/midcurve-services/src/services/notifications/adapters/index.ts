/**
 * Notification Adapters
 *
 * Barrel export for notification delivery adapters.
 */

export type { NotificationAdapter } from './notification-adapter.js';

export {
  UiNotificationAdapter,
  type UiNotificationAdapterDependencies,
} from './ui-notification-adapter.js';

export {
  WebhookNotificationAdapter,
  type WebhookNotificationAdapterDependencies,
  type WebhookDeliveryResult,
} from './webhook-notification-adapter.js';
