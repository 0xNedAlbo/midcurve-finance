/**
 * Date Formatting Utilities
 *
 * Thin wrappers around @midcurve/shared date formatters.
 * Keeps backward-compatible API for existing consumers.
 */

import {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
} from '@midcurve/shared';

/**
 * Format a timestamp into separate date and time components.
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Object with date, time, and full formatted strings
 */
export function formatEventDateTime(timestamp: string): {
  date: string;
  time: string;
  full: string;
} {
  return {
    date: formatDate(timestamp),
    time: formatTime(timestamp),
    full: formatDateTime(timestamp),
  };
}

/**
 * Format a timestamp for block display.
 * Format: "Feb 08, 2026 at 1:41 PM"
 */
export function formatBlockTimestamp(timestamp: string): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return 'Invalid date';

  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${formatDate(timestamp)} at ${timeStr}`;
}

// Re-export shared formatters for convenience
export { formatDate, formatTime, formatDateTime, formatRelativeTime };
