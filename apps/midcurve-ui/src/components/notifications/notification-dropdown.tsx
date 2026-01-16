/**
 * Notification Dropdown Component
 *
 * Dropdown showing the 10 most recent notifications with quick actions.
 * Does NOT auto-mark as read - user must click individual notifications.
 */

import { useNavigate } from 'react-router-dom';
import { Bell, Check, ExternalLink, Loader2 } from 'lucide-react';
import { NotificationItem } from './notification-item';
import {
  useNotifications,
  useMarkNotificationAsRead,
  useMarkAllNotificationsAsRead,
} from '@/hooks/notifications';

interface NotificationDropdownProps {
  onClose: () => void;
}

export function NotificationDropdown({ onClose }: NotificationDropdownProps) {
  const navigate = useNavigate();

  // Fetch recent notifications
  const { data, isLoading, isError } = useNotifications({ limit: 10 });
  const markAsRead = useMarkNotificationAsRead();
  const markAllAsRead = useMarkAllNotificationsAsRead();

  const notifications = data?.notifications || [];
  const hasUnread = notifications.some((n) => !n.isRead);

  const handleNotificationClick = (notificationId: string) => {
    // Mark as read when clicked
    markAsRead.mutate(notificationId);
    onClose();
  };

  const handleMarkAllRead = () => {
    markAllAsRead.mutate();
  };

  const handleViewAll = () => {
    navigate('/notifications');
    onClose();
  };

  return (
    <div className="absolute right-0 mt-2 w-80 max-h-[32rem] bg-slate-800/95 backdrop-blur-md rounded-lg border border-slate-700/50 shadow-xl shadow-black/20 z-50 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-sm font-medium text-slate-100">Notifications</h3>
        {hasUnread && (
          <button
            onClick={handleMarkAllRead}
            disabled={markAllAsRead.isPending}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            {markAllAsRead.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Mark all as read
          </button>
        )}
      </div>

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <p className="text-sm text-red-400">Failed to load notifications</p>
            <p className="text-xs text-slate-500 mt-1">Please try again later</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center px-4">
            <Bell className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-sm text-slate-400">No notifications yet</p>
            <p className="text-xs text-slate-500 mt-1">
              You'll be notified about position events here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700/30">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onClick={() => handleNotificationClick(notification.id)}
                compact
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="border-t border-slate-700/50">
          <button
            onClick={handleViewAll}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm text-blue-400 hover:text-blue-300 hover:bg-slate-700/30 transition-colors cursor-pointer"
          >
            View all notifications
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
