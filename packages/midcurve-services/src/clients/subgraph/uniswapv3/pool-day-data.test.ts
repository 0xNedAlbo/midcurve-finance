import { describe, it, expect } from 'vitest';
import { dropPartialDayEntry } from './pool-day-data.js';

const SECONDS_PER_DAY = 86400;

function midnightUtcSec(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month, day) / 1000);
}

describe('dropPartialDayEntry', () => {
  it('returns empty array for empty input', () => {
    const now = new Date(Date.UTC(2026, 3, 25, 12, 0, 0));
    expect(dropPartialDayEntry([], now)).toEqual([]);
  });

  it('drops [0] when its date is today UTC midnight', () => {
    const now = new Date(Date.UTC(2026, 3, 25, 0, 0, 1));
    const today = midnightUtcSec(2026, 3, 25);
    const entries = [
      { date: today, volumeUSD: '100' },
      { date: today - SECONDS_PER_DAY, volumeUSD: '200' },
      { date: today - 2 * SECONDS_PER_DAY, volumeUSD: '300' },
    ];

    const result = dropPartialDayEntry(entries, now);

    expect(result).toHaveLength(2);
    expect(result[0]!.volumeUSD).toBe('200');
    expect(result[1]!.volumeUSD).toBe('300');
  });

  it('returns full copy when [0] is yesterday (subgraph has not yet created today)', () => {
    const now = new Date(Date.UTC(2026, 3, 25, 0, 5, 0));
    const today = midnightUtcSec(2026, 3, 25);
    const entries = [
      { date: today - SECONDS_PER_DAY, volumeUSD: '200' },
      { date: today - 2 * SECONDS_PER_DAY, volumeUSD: '300' },
    ];

    const result = dropPartialDayEntry(entries, now);

    expect(result).toHaveLength(2);
    expect(result[0]!.volumeUSD).toBe('200');
  });

  it('treats UTC consistently regardless of host TZ-related Date calls', () => {
    // 23:59 UTC — host local time may be next-day in eastern TZs, but we use UTC accessors.
    const now = new Date(Date.UTC(2026, 3, 25, 23, 59, 0));
    const today = midnightUtcSec(2026, 3, 25);
    const entries = [{ date: today, volumeUSD: '999' }];

    const result = dropPartialDayEntry(entries, now);

    expect(result).toEqual([]);
  });

  it('returns a copy, not the original array', () => {
    const now = new Date(Date.UTC(2026, 3, 25, 12, 0, 0));
    const today = midnightUtcSec(2026, 3, 25);
    const entries = [{ date: today - SECONDS_PER_DAY, volumeUSD: '200' }];

    const result = dropPartialDayEntry(entries, now);

    expect(result).not.toBe(entries);
    expect(result).toEqual(entries);
  });
});
