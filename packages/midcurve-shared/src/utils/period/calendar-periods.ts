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

export function getCalendarPeriodBoundaries(
  period: CalendarPeriod,
  now: Date = new Date(),
): PeriodBoundaries {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...

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

  return {
    currentStart,
    currentEnd: now,
    previousStart,
    previousEnd: currentStart,
  };
}
