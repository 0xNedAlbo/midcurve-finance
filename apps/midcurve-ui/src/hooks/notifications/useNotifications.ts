/**
 * Notifications Hooks
 *
 * React Query hooks for managing user notifications and webhook configuration.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationData,
  ListNotificationsResponseData,
  UnreadCountResponseData,
  MarkAllReadResponseData,
  WebhookConfigData,
  UpdateWebhookConfigBody,
  TestWebhookResponseData,
  NotificationEventType,
} from '@midcurve/api-shared';
import { notificationsApi } from '../../lib/api-client';

// =============================================================================
// Query Keys
// =============================================================================

export const notificationKeys = {
  all: ['notifications'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) => [...notificationKeys.lists(), filters] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  detail: (id: string) => [...notificationKeys.all, 'detail', id] as const,
  webhookConfig: () => ['webhook-config'] as const,
};

// =============================================================================
// Notification Queries
// =============================================================================

/**
 * Hook to fetch notifications with pagination
 */
export function useNotifications(params: {
  limit?: number;
  cursor?: string;
  eventType?: string;
  isRead?: string;
} = {}) {
  return useQuery<ListNotificationsResponseData>({
    queryKey: notificationKeys.list(params),
    queryFn: async () => {
      const response = await notificationsApi.listNotifications(params);
      return response.data;
    },
  });
}

/**
 * Hook to fetch unread notification count
 */
export function useUnreadNotificationCount() {
  return useQuery<UnreadCountResponseData>({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async () => {
      const response = await notificationsApi.getUnreadCount();
      return response.data;
    },
    // Poll every 30 seconds for new notifications
    refetchInterval: 30000,
  });
}

/**
 * Hook to fetch a single notification
 */
export function useNotification(id: string) {
  return useQuery<NotificationData>({
    queryKey: notificationKeys.detail(id),
    queryFn: async () => {
      const response = await notificationsApi.getNotification(id);
      return response.data;
    },
    enabled: !!id,
  });
}

// =============================================================================
// Notification Mutations
// =============================================================================

/**
 * Hook to mark a single notification as read
 */
export function useMarkNotificationAsRead() {
  const queryClient = useQueryClient();

  return useMutation<NotificationData, Error, string>({
    mutationFn: async (id: string) => {
      const response = await notificationsApi.markAsRead(id);
      return response.data;
    },
    onSuccess: (data) => {
      // Update the notification in cache
      queryClient.setQueryData(notificationKeys.detail(data.id), data);
      // Invalidate list and count queries
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
    },
  });
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllNotificationsAsRead() {
  const queryClient = useQueryClient();

  return useMutation<MarkAllReadResponseData, Error, void>({
    mutationFn: async () => {
      const response = await notificationsApi.markAllAsRead();
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all notification queries
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/**
 * Hook to delete a single notification
 */
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: async (id: string) => {
      await notificationsApi.deleteNotification(id);
    },
    onSuccess: (_, id) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: notificationKeys.detail(id) });
      // Invalidate list and count queries
      queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
    },
  });
}

/**
 * Hook to bulk delete notifications
 */
export function useBulkDeleteNotifications() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string[]>({
    mutationFn: async (ids: string[]) => {
      await notificationsApi.bulkDelete(ids);
    },
    onSuccess: () => {
      // Invalidate all notification queries
      queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

// =============================================================================
// Webhook Config Queries & Mutations
// =============================================================================

/**
 * Hook to fetch webhook configuration
 */
export function useWebhookConfig() {
  return useQuery<WebhookConfigData | null>({
    queryKey: notificationKeys.webhookConfig(),
    queryFn: async () => {
      try {
        const response = await notificationsApi.getWebhookConfig();
        return response.data;
      } catch {
        // Return null if not configured
        return null;
      }
    },
  });
}

/**
 * Hook to update webhook configuration
 */
export function useUpdateWebhookConfig() {
  const queryClient = useQueryClient();

  return useMutation<WebhookConfigData, Error, UpdateWebhookConfigBody>({
    mutationFn: async (input: UpdateWebhookConfigBody) => {
      const response = await notificationsApi.updateWebhookConfig(input);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(notificationKeys.webhookConfig(), data);
    },
  });
}

/**
 * Hook to send a test webhook
 * @param eventType - Optional event type to test specific payloads
 */
export function useTestWebhook() {
  return useMutation<TestWebhookResponseData, Error, NotificationEventType | undefined>({
    mutationFn: async (eventType?: NotificationEventType) => {
      const response = await notificationsApi.testWebhook(eventType);
      return response.data;
    },
  });
}
