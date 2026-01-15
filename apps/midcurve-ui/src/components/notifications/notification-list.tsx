/**
 * Notification List Component
 *
 * Full notification list with pagination, filtering, bulk select, and delete.
 * Clicking a notification marks it as read.
 */

import { useState, useCallback } from 'react';
import { Bell, Trash2, Check, ChevronDown, Loader2, AlertCircle } from 'lucide-react';
import { NotificationItem } from './notification-item';
import {
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
  useDeleteNotification,
  useBulkDeleteNotifications,
} from '@/hooks/notifications';
import type { NotificationData } from '@midcurve/api-shared';

type FilterOption = 'all' | 'unread' | 'read';

export function NotificationList() {
  const [filter, setFilter] = useState<FilterOption>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Build query params
  const queryParams = {
    limit: 20,
    cursor,
    ...(filter !== 'all' && { isRead: filter === 'read' ? 'true' : 'false' }),
  };

  // Queries and mutations
  const { data, isLoading, isError, refetch } = useNotifications(queryParams);
  const markAsRead = useMarkNotificationAsRead();
  const markAllAsRead = useMarkAllNotificationsAsRead();
  const deleteNotification = useDeleteNotification();
  const bulkDelete = useBulkDeleteNotifications();

  const notifications = data?.notifications || [];
  const hasMore = data?.hasMore ?? false;
  const hasUnread = notifications.some((n) => !n.isRead);
  const isAllSelected = notifications.length > 0 && selectedIds.size === notifications.length;
  const hasSelection = selectedIds.size > 0;

  // Handlers
  const handleNotificationClick = useCallback((notification: NotificationData) => {
    if (!notification.isRead) {
      markAsRead.mutate(notification.id);
    }
  }, [markAsRead]);

  const handleDelete = useCallback((id: string) => {
    deleteNotification.mutate(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [deleteNotification]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size > 0) {
      bulkDelete.mutate(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [bulkDelete, selectedIds]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notifications.map((n) => n.id)));
    }
  }, [isAllSelected, notifications]);

  const handleLoadMore = useCallback(() => {
    if (data?.nextCursor) {
      setCursor(data.nextCursor);
    }
  }, [data?.nextCursor]);

  const handleFilterChange = useCallback((newFilter: FilterOption) => {
    setFilter(newFilter);
    setCursor(undefined);
    setSelectedIds(new Set());
    setShowFilterDropdown(false);
  }, []);

  // Loading state
  if (isLoading && !cursor) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        <p className="text-sm text-slate-400 mt-4">Loading notifications...</p>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
        <p className="text-sm text-red-400 font-medium">Failed to load notifications</p>
        <p className="text-xs text-slate-500 mt-1">Please try again later</p>
        <button
          onClick={() => refetch()}
          className="mt-4 px-4 py-2 text-sm bg-slate-700/50 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (notifications.length === 0 && !cursor) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Bell className="w-12 h-12 text-slate-600 mb-3" />
        <p className="text-lg text-slate-300 font-medium">No notifications</p>
        <p className="text-sm text-slate-500 mt-1">
          {filter === 'unread'
            ? "You're all caught up!"
            : filter === 'read'
            ? 'No read notifications'
            : "You'll be notified about position events here"}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          {/* Select All */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={handleSelectAll}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-slate-400">
              {hasSelection ? `${selectedIds.size} selected` : 'Select all'}
            </span>
          </label>

          {/* Bulk Actions */}
          {hasSelection && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors cursor-pointer disabled:opacity-50"
            >
              {bulkDelete.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Delete
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Mark All Read */}
          {hasUnread && !hasSelection && (
            <button
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
              className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              {markAllAsRead.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Mark all as read
            </button>
          )}

          {/* Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
            >
              {filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : 'Read'}
              <ChevronDown className="w-4 h-4" />
            </button>

            {showFilterDropdown && (
              <div className="absolute right-0 mt-1 w-32 bg-slate-800 rounded-lg border border-slate-700/50 shadow-xl z-10 overflow-hidden">
                {(['all', 'unread', 'read'] as FilterOption[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => handleFilterChange(option)}
                    className={`w-full px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                      filter === option
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'text-slate-300 hover:bg-slate-700/50'
                    }`}
                  >
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="divide-y divide-slate-700/30">
        {notifications.map((notification) => (
          <div key={notification.id} className="flex items-start">
            {/* Checkbox */}
            <div className="flex items-center pl-4 pt-4">
              <input
                type="checkbox"
                checked={selectedIds.has(notification.id)}
                onChange={() => handleToggleSelect(notification.id)}
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
              />
            </div>

            {/* Notification Item */}
            <div className="flex-1">
              <NotificationItem
                notification={notification}
                onClick={() => handleNotificationClick(notification)}
                onDelete={() => handleDelete(notification.id)}
                showDelete
              />
            </div>
          </div>
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="px-4 py-3 border-t border-slate-700/50">
          <button
            onClick={handleLoadMore}
            disabled={isLoading}
            className="w-full py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-slate-700/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading...
              </span>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
