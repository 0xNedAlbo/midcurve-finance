/**
 * Notification Item Component
 *
 * Displays a single notification with icon, title, message, and time.
 */

import type { NotificationData } from '@midcurve/api-shared';
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface NotificationItemProps {
  notification: NotificationData;
  onClick?: () => void;
  onDelete?: () => void;
  showDelete?: boolean;
  compact?: boolean;
}

/**
 * Get icon and color for notification event type
 */
function getNotificationIcon(eventType: string) {
  switch (eventType) {
    case 'POSITION_OUT_OF_RANGE':
      return { icon: ArrowDownRight, color: 'text-yellow-400', bgColor: 'bg-yellow-400/10' };
    case 'POSITION_IN_RANGE':
      return { icon: ArrowUpRight, color: 'text-green-400', bgColor: 'bg-green-400/10' };
    case 'STOP_LOSS_EXECUTED':
      return { icon: CheckCircle, color: 'text-blue-400', bgColor: 'bg-blue-400/10' };
    case 'TAKE_PROFIT_EXECUTED':
      return { icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-400/10' };
    case 'STOP_LOSS_FAILED':
    case 'TAKE_PROFIT_FAILED':
      return { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-400/10' };
    default:
      return { icon: AlertTriangle, color: 'text-slate-400', bgColor: 'bg-slate-400/10' };
  }
}

/**
 * Format timestamp to relative time
 */
function formatTime(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return timestamp;
  }
}

export function NotificationItem({
  notification,
  onClick,
  onDelete,
  showDelete = false,
  compact = false,
}: NotificationItemProps) {
  const { icon: Icon, color, bgColor } = getNotificationIcon(notification.eventType);
  const isUnread = !notification.isRead;

  return (
    <div
      className={`
        group flex items-start gap-3 p-3 transition-colors
        ${onClick ? 'cursor-pointer hover:bg-slate-700/30' : ''}
        ${isUnread ? 'bg-slate-800/50' : ''}
      `}
      onClick={onClick}
    >
      {/* Icon */}
      <div className={`flex-shrink-0 p-2 rounded-lg ${bgColor}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h4
              className={`text-sm font-medium truncate ${
                isUnread ? 'text-slate-100' : 'text-slate-300'
              }`}
            >
              {notification.title}
            </h4>
            {!compact && (
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                {notification.message}
              </p>
            )}
          </div>

          {/* Unread indicator */}
          {isUnread && (
            <div className="flex-shrink-0 w-2 h-2 mt-1.5 rounded-full bg-blue-500" />
          )}
        </div>

        {/* Timestamp */}
        <p className="text-xs text-slate-500 mt-1">
          {formatTime(notification.createdAt)}
        </p>
      </div>

      {/* Delete button */}
      {showDelete && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex-shrink-0 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-900/20 text-slate-500 hover:text-red-400 transition-all cursor-pointer"
          title="Delete notification"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
