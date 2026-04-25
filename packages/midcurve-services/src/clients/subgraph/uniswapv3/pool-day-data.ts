export interface PoolDayDataLike {
  date: number;
}

/**
 * The subgraph's poolDayData[0] is the *current UTC day in progress* —
 * it accumulates from 00:00 UTC and is incomplete until the next midnight.
 * Drop it so callers only see complete days.
 *
 * `now` is injectable so tests can pin the clock without `vi.useFakeTimers`.
 */
export function dropPartialDayEntry<T extends PoolDayDataLike>(
  entries: readonly T[],
  now: Date = new Date()
): T[] {
  if (entries.length === 0) return [];
  const todayMidnightSec = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000
  );
  return entries[0]!.date === todayMidnightSec ? entries.slice(1) : entries.slice();
}
