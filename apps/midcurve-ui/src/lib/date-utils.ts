/**
 * Date Formatting Utilities
 *
 * Provides English-only date and time formatting for ledger events
 * and other timestamp displays.
 */

/**
 * Format a timestamp into separate date and time components
 * Format: "Oct 31, 2025" and "03:10:36 PM"
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Object with date, time, and full formatted strings
 */
export function formatEventDateTime(timestamp: string): {
  date: string;
  time: string;
  full: string;
} {
  const date = new Date(timestamp);

  // Check for invalid date
  if (isNaN(date.getTime())) {
    return {
      date: 'Invalid date',
      time: '',
      full: 'Invalid date',
    };
  }

  // Format date: "Oct 31, 2025"
  const dateString = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });

  // Format time: "03:10:36 PM"
  const timeString = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  // Full format: "Oct 31, 2025, 03:10:36 PM"
  const fullString = `${dateString}, ${timeString}`;

  return {
    date: dateString,
    time: timeString,
    full: fullString,
  };
}

/**
 * Format a timestamp for block display
 * Format: "Oct 31, 2025 at 3:10 PM"
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Formatted string for block timestamp display
 */
export function formatBlockTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const dateStr = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${dateStr} at ${timeStr}`;
}

/**
 * Format a timestamp as a relative time string
 * Examples: "2 hours ago", "3 days ago", "Just now"
 *
 * @param timestamp - ISO 8601 timestamp string
 * @returns Relative time string
 */
export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'Just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
  } else if (diffDay < 30) {
    return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  } else {
    // For older dates, return absolute date
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
