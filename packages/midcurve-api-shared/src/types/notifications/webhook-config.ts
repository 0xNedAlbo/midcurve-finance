/**
 * Webhook Configuration Endpoint Types
 *
 * Types for managing user webhook delivery preferences.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';
import type { NotificationEventType } from './notification-types.js';
import { NOTIFICATION_EVENT_TYPES } from './notification-types.js';

// =============================================================================
// WEBHOOK CONFIG DATA
// =============================================================================

/**
 * Webhook configuration data for API responses
 */
export interface WebhookConfigData {
  webhookUrl: string | null;
  isActive: boolean;
  enabledEvents: NotificationEventType[];
  hasSecret: boolean; // Don't expose the actual secret, just whether it's set
  lastDeliveryAt: string | null;
  lastDeliveryStatus: 'success' | 'failed' | null;
  lastDeliveryError: string | null;
}

// =============================================================================
// GET WEBHOOK CONFIG
// =============================================================================

/**
 * Response type for getting webhook configuration
 */
export type GetWebhookConfigResponse = ApiResponse<WebhookConfigData>;

// =============================================================================
// UPDATE WEBHOOK CONFIG
// =============================================================================

/**
 * Request body schema for updating webhook configuration
 */
export const UpdateWebhookConfigBodySchema = z.object({
  webhookUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  enabledEvents: z.array(z.enum(NOTIFICATION_EVENT_TYPES)).optional(),
  webhookSecret: z.string().min(16).max(128).nullable().optional(),
});

export type UpdateWebhookConfigBody = z.infer<typeof UpdateWebhookConfigBodySchema>;

/**
 * Response type for updating webhook configuration
 */
export type UpdateWebhookConfigResponse = ApiResponse<WebhookConfigData>;

// =============================================================================
// TEST WEBHOOK
// =============================================================================

/**
 * Response data for test webhook
 */
export interface TestWebhookResponseData {
  success: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

/**
 * Response type for testing webhook delivery
 */
export type TestWebhookResponse = ApiResponse<TestWebhookResponseData>;

// =============================================================================
// WEBHOOK PAYLOAD (sent to external webhooks)
// =============================================================================

/**
 * Standard webhook payload sent to user's webhook URL
 */
export interface WebhookDeliveryPayload {
  /** Unique event ID for deduplication */
  eventId: string;
  /** Event type */
  eventType: NotificationEventType;
  /** ISO timestamp when the event occurred */
  timestamp: string;
  /** Short event summary */
  title: string;
  /** Detailed message */
  message: string;
  /** Position identifier (if applicable) */
  positionId: string | null;
  /** Event-specific data */
  data: Record<string, unknown>;
}
