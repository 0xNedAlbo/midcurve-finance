/**
 * List Notifications Endpoint Types
 *
 * Types for listing and managing user notifications.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';
import type { NotificationData } from './notification-types.js';
import { NOTIFICATION_EVENT_TYPES } from './notification-types.js';

// =============================================================================
// LIST NOTIFICATIONS
// =============================================================================

/**
 * Query schema for listing notifications
 */
export const ListNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().optional(),
  eventType: z.enum(NOTIFICATION_EVENT_TYPES).optional(),
  isRead: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

/**
 * Response data for listing notifications
 */
export interface ListNotificationsResponseData {
  notifications: NotificationData[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Response type for listing notifications
 */
export type ListNotificationsResponse = ApiResponse<ListNotificationsResponseData>;

// =============================================================================
// GET UNREAD COUNT
// =============================================================================

/**
 * Response data for unread count
 */
export interface UnreadCountResponseData {
  count: number;
}

/**
 * Response type for getting unread count
 */
export type GetUnreadCountResponse = ApiResponse<UnreadCountResponseData>;

// =============================================================================
// GET SINGLE NOTIFICATION
// =============================================================================

/**
 * Response type for getting a single notification
 */
export type GetNotificationResponse = ApiResponse<NotificationData>;

// =============================================================================
// MARK AS READ
// =============================================================================

/**
 * Response type for marking a notification as read
 */
export type MarkNotificationReadResponse = ApiResponse<NotificationData>;

/**
 * Response data for mark all as read
 */
export interface MarkAllReadResponseData {
  count: number;
}

/**
 * Response type for marking all notifications as read
 */
export type MarkAllNotificationsReadResponse = ApiResponse<MarkAllReadResponseData>;

// =============================================================================
// DELETE NOTIFICATIONS
// =============================================================================

/**
 * Response data for delete notification
 */
export interface DeleteNotificationResponseData {
  deleted: boolean;
}

/**
 * Response type for deleting a notification
 */
export type DeleteNotificationResponse = ApiResponse<DeleteNotificationResponseData>;

/**
 * Request body schema for bulk delete
 */
export const BulkDeleteNotificationsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

export type BulkDeleteNotificationsBody = z.infer<typeof BulkDeleteNotificationsBodySchema>;

/**
 * Response data for bulk delete
 */
export interface BulkDeleteNotificationsResponseData {
  deletedCount: number;
}

/**
 * Response type for bulk deleting notifications
 */
export type BulkDeleteNotificationsResponse = ApiResponse<BulkDeleteNotificationsResponseData>;
