/**
 * Notification Adapters
 *
 * Barrel export for notification delivery adapters.
 */

export type { NotificationAdapter } from './notification-adapter.js';

export {
  DbNotificationAdapter,
  type DbNotificationAdapterDependencies,
} from './db-notification-adapter.js';

export {
  WebhookNotificationAdapter,
  type WebhookNotificationAdapterDependencies,
  type WebhookDeliveryResult,
} from './webhook-notification-adapter.js';
