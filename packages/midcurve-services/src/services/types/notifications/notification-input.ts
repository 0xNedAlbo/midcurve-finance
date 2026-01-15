/**
 * Notification Service Input Types
 *
 * Input types for notification-related service operations.
 */

import type { NotificationEventType, NotificationPayload } from '@midcurve/api-shared';

// =============================================================================
// NOTIFICATION INPUTS
// =============================================================================

/**
 * Input for creating a notification
 */
export interface CreateNotificationInput {
  userId: string;
  eventType: NotificationEventType;
  positionId?: string | null;
  title: string;
  message: string;
  payload: NotificationPayload;
}

/**
 * Options for listing notifications
 */
export interface ListNotificationsOptions {
  eventType?: NotificationEventType;
  isRead?: boolean;
  limit?: number;
  cursor?: string;
}

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

// =============================================================================
// RANGE STATUS INPUTS
// =============================================================================

/**
 * Input for updating position range status
 */
export interface UpdateRangeStatusInput {
  isInRange: boolean;
  sqrtPriceX96: string;
  tick: number;
}

/**
 * Information about a position for range tracking
 */
export interface PositionRangeTrackingInfo {
  positionId: string;
  userId: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  chainId: number;
  poolAddress: string;
  currentRangeStatus: {
    isInRange: boolean;
    lastTick: number;
  } | null;
}

/**
 * Result of a range status change detection
 */
export interface RangeStatusChangeResult {
  positionId: string;
  userId: string;
  previouslyInRange: boolean;
  nowInRange: boolean;
  currentTick: number;
  sqrtPriceX96: string;
}
