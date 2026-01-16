/**
 * Notification Bell Component
 *
 * Bell icon with unread badge that opens the notification dropdown.
 */

import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { NotificationDropdown } from './notification-dropdown';
import { useUnreadNotificationCount } from '@/hooks/notifications';

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch unread count (polls every 30 seconds)
  const { data } = useUnreadNotificationCount();
  const unreadCount = data?.count || 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors cursor-pointer"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5" />

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-xs font-medium text-white bg-blue-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && <NotificationDropdown onClose={() => setIsOpen(false)} />}
    </div>
  );
}
