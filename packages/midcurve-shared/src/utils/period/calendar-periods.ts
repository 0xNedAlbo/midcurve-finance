/**
 * Calendar-based period boundary computation.
 *
 * All boundaries are UTC midnight-aligned. "Current period" runs from the
 * start of the calendar period to `now`. "Previous period" is the full
 * preceding calendar period of the same length.
 */

export type CalendarPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface PeriodBoundaries {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function getQuarterStartMonth(month: number): number {
  return Math.floor(month / 3) * 3;
}

/**
 * Shifts a reference date backwards by `|offset|` calendar periods.
 * offset must be <= 0 (0 = current, -1 = previous, etc.).
 */
function shiftDate(now: Date, period: CalendarPeriod, offset: number): Date {
  if (offset === 0) return now;
  const shifts = Math.abs(offset);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  switch (period) {
    case 'day':
      return utcMidnight(y, m, d - shifts);
    case 'week':
      return utcMidnight(y, m, d - shifts * 7);
    case 'month':
      return utcMidnight(y, m - shifts, d);
    case 'quarter':
      return utcMidnight(y, m - shifts * 3, d);
    case 'year':
      return utcMidnight(y - shifts, m, d);
  }
}

/**
 * Computes the end of the calendar period that contains `ref`.
 * Returns UTC midnight of the first day of the next period.
 */
function getPeriodEnd(ref: Date, period: CalendarPeriod): Date {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const d = ref.getUTCDate();
  const dow = ref.getUTCDay();

  switch (period) {
    case 'day':
      return utcMidnight(y, m, d + 1);
    case 'week': {
      const daysFromMonday = dow === 0 ? 6 : dow - 1;
      return utcMidnight(y, m, d - daysFromMonday + 7);
    }
    case 'month':
      return utcMidnight(y, m + 1, 1);
    case 'quarter': {
      const qStart = getQuarterStartMonth(m);
      return utcMidnight(y, qStart + 3, 1);
    }
    case 'year':
      return utcMidnight(y + 1, 0, 1);
  }
}

export function getCalendarPeriodBoundaries(
  period: CalendarPeriod,
  now: Date = new Date(),
  offset: number = 0,
): PeriodBoundaries {
  const ref = shiftDate(now, period, offset);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  const day = ref.getUTCDate();
  const dayOfWeek = ref.getUTCDay(); // 0=Sun, 1=Mon, ...

  let currentStart: Date;
  let previousStart: Date;

  switch (period) {
    case 'day': {
      currentStart = utcMidnight(year, month, day);
      previousStart = utcMidnight(year, month, day - 1);
      break;
    }
    case 'week': {
      // ISO week: Monday = start of week
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      currentStart = utcMidnight(year, month, day - daysFromMonday);
      previousStart = utcMidnight(year, month, day - daysFromMonday - 7);
      break;
    }
    case 'month': {
      currentStart = utcMidnight(year, month, 1);
      previousStart = utcMidnight(year, month - 1, 1);
      break;
    }
    case 'quarter': {
      const qStart = getQuarterStartMonth(month);
      currentStart = utcMidnight(year, qStart, 1);
      previousStart = utcMidnight(year, qStart - 3, 1);
      break;
    }
    case 'year': {
      currentStart = utcMidnight(year, 0, 1);
      previousStart = utcMidnight(year - 1, 0, 1);
      break;
    }
  }

  // For historical periods (offset < 0), currentEnd is the end of that
  // calendar period. For the current period (offset === 0), it's `now`.
  const currentEnd = offset < 0 ? getPeriodEnd(ref, period) : now;

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd: currentStart,
  };
}
