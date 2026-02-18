/**
 * Notification Service Input Types
 *
 * Input types for notification-related service operations.
 */

import type { NotificationEventType } from '@midcurve/api-shared';

// =============================================================================
// WEBHOOK CONFIG INPUTS
// =============================================================================

/**
 * Input for updating webhook configuration
 */
export interface UpdateWebhookConfigInput {
  webhookUrl?: string | null;
  isActive?: boolean;
  enabledEvents?: NotificationEventType[];
  webhookSecret?: string | null;
}
