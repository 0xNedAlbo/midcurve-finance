/**
 * Date/Time Formatting Utilities
 *
 * Provides consistent en-US date and time formatting across the entire platform.
 * All functions accept either a Date object or an ISO 8601 string.
 */

/** Parse a Date | string input, returning a Date object. */
function toDate(input: Date | string): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * Format date only: "Feb 08, 2026"
 */
export function formatDate(input: Date | string): string {
  const d = toDate(input);
  if (isNaN(d.getTime())) return 'Invalid date';

  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/**
 * Format time only: "01:41:54 PM"
 */
export function formatTime(input: Date | string): string {
  const d = toDate(input);
  if (isNaN(d.getTime())) return '';

  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Format date and time: "Feb 08, 2026, 01:41:54 PM"
 */
export function formatDateTime(input: Date | string): string {
  const d = toDate(input);
  if (isNaN(d.getTime())) return 'Invalid date';

  return `${formatDate(d)}, ${formatTime(d)}`;
}

/**
 * Format a timestamp as a relative time string.
 *
 * Returns "Just now", "5 minutes ago", "3 hours ago", "7 days ago", etc.
 * Falls back to an absolute date for timestamps older than 30 days.
 */
export function formatRelativeTime(input: Date | string): string {
  const d = toDate(input);
  if (isNaN(d.getTime())) return 'Invalid date';

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  if (diffDay < 30) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;

  return formatDate(d);
}
