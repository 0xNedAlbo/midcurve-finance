import { describe, it, expect } from 'vitest';
import {
  buildUnrealizedWindowSnapshots,
  calculateTimeWeightedCostBasis,
  type CostBasisSnapshot,
} from './apr-calculations.js';

/**
 * Time-weighting the open APR window (issue #135).
 *
 * Completed APR periods have always weighted their cost basis by the time it
 * was deployed. The open window did not — it divided unclaimed fees by the cost
 * basis standing at the end of the window, so enlarging a position dropped its
 * displayed APR the instant the shares were minted.
 */

const t = (iso: string) => new Date(iso);

describe('calculateTimeWeightedCostBasis', () => {
  it('weights each cost basis by the duration it was deployed', () => {
    // 1,000 USDC for 10 days, then 5,000 USDC for 2 days
    const events: CostBasisSnapshot[] = [
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 1000_000000n },
      { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 5000_000000n },
      { timestamp: t('2026-01-13T00:00:00Z'), costBasisAfter: 5000_000000n },
    ];

    // (1,000 × 10 + 5,000 × 2) / 12 = 1,666.67
    expect(calculateTimeWeightedCostBasis(events)).toBe(1666_666666n);
  });

  it('returns the sole cost basis when there is only one snapshot', () => {
    const events: CostBasisSnapshot[] = [
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 1000_000000n },
    ];

    expect(calculateTimeWeightedCostBasis(events)).toBe(1000_000000n);
  });

  it('is exact for a constant cost basis — no rounding drift', () => {
    const events: CostBasisSnapshot[] = [
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 79999_920000n },
      { timestamp: t('2026-01-07T13:41:09Z'), costBasisAfter: 79999_920000n },
      { timestamp: t('2026-02-02T04:17:55Z'), costBasisAfter: 79999_920000n },
    ];

    expect(calculateTimeWeightedCostBasis(events)).toBe(79999_920000n);
  });

  it('throws on a zero-span window', () => {
    const events: CostBasisSnapshot[] = [
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 1000_000000n },
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 2000_000000n },
    ];

    expect(() => calculateTimeWeightedCostBasis(events)).toThrow(
      /non-zero time/
    );
  });

  it('throws on non-chronological snapshots', () => {
    const events: CostBasisSnapshot[] = [
      { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 1000_000000n },
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 2000_000000n },
    ];

    expect(() => calculateTimeWeightedCostBasis(events)).toThrow(
      /chronological/
    );
  });
});

describe('buildUnrealizedWindowSnapshots', () => {
  it('seeds at the window start and closes at asOf', () => {
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-01-01T00:00:00Z'),
      windowStartCostBasis: 1000_000000n,
      events: [
        { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 5000_000000n },
      ],
      asOf: t('2026-01-13T00:00:00Z'),
      currentCostBasis: 5000_000000n,
    });

    expect(snapshots).toEqual([
      { timestamp: t('2026-01-01T00:00:00Z'), costBasisAfter: 1000_000000n },
      { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 5000_000000n },
      { timestamp: t('2026-01-13T00:00:00Z'), costBasisAfter: 5000_000000n },
    ]);
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(1666_666666n);
  });

  it('reproduces the position reported in issue #135', () => {
    // Ledger values, not screen values: the displayed cost basis (79,999.93)
    // and the sum of the displayed event values (79,999.92) differ by a cent.
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-07-22T10:22:17Z'), // mint 1, 49,999.99 USDC
      windowStartCostBasis: 49999_990000n,
      events: [
        // mint 2, +29,999.93 USDC
        { timestamp: t('2026-08-11T09:24:07Z'), costBasisAfter: 79999_920000n },
      ],
      asOf: t('2026-08-12T10:57:03Z'),
      currentCostBasis: 79999_920000n,
    });

    // ~19.96 days at ~50k, ~1.06 days at ~80k — not 21 days at 80k.
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(51519_007246n);
  });

  it('holds the pre-change basis at full weight the instant capital is added', () => {
    // AC 1: enlarging must not move the APR at the moment of the enlargement.
    const asOf = t('2026-08-11T09:24:07Z');
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-07-22T10:22:17Z'),
      windowStartCostBasis: 49999_990000n,
      events: [{ timestamp: asOf, costBasisAfter: 79999_920000n }],
      asOf,
      currentCostBasis: 79999_920000n,
    });

    // The new capital has earned nothing yet, so it weighs nothing yet.
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(49999_990000n);
  });

  it('holds the pre-change basis at full weight the instant capital is removed', () => {
    // AC 3: reducing must not inflate the APR at the moment of the reduction.
    const asOf = t('2026-08-11T09:24:07Z');
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-07-22T10:22:17Z'),
      windowStartCostBasis: 79999_920000n,
      events: [{ timestamp: asOf, costBasisAfter: 29999_930000n }],
      asOf,
      currentCostBasis: 29999_930000n,
    });

    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(79999_920000n);
  });

  it('is inert for a position that never resized', () => {
    // AC 5: same denominator before and after the change.
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-07-22T10:22:17Z'),
      windowStartCostBasis: 49999_990000n,
      events: [],
      asOf: t('2026-08-12T10:57:03Z'),
      currentCostBasis: 49999_990000n,
    });

    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(49999_990000n);
  });

  it('keeps zero-length segments when several events share a timestamp', () => {
    // A vault burn emits its share transfer and its YieldCollected in one
    // block. The last event at that instant is the one that carries forward.
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-01-01T00:00:00Z'),
      windowStartCostBasis: 1000_000000n,
      events: [
        { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 600_000000n },
        { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 500_000000n },
      ],
      asOf: t('2026-01-21T00:00:00Z'),
      currentCostBasis: 500_000000n,
    });

    // (1,000 × 10 + 600 × 0 + 500 × 10) / 20 = 750
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(750_000000n);
  });

  it('collapses a zero-span window to the current cost basis', () => {
    const asOf = t('2026-01-01T00:00:00Z');
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: asOf,
      windowStartCostBasis: 1000_000000n,
      events: [],
      asOf,
      currentCostBasis: 1000_000000n,
    });

    expect(snapshots).toEqual([
      { timestamp: asOf, costBasisAfter: 1000_000000n },
    ]);
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(1000_000000n);
  });

  it('does not close the window when asOf precedes the last event', () => {
    // Block timestamps can run ahead of wall clock. Appending asOf here would
    // hand calculateTimeWeightedCostBasis a backwards segment.
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-01-01T00:00:00Z'),
      windowStartCostBasis: 1000_000000n,
      events: [
        { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 5000_000000n },
      ],
      asOf: t('2026-01-05T00:00:00Z'),
      currentCostBasis: 5000_000000n,
    });

    expect(snapshots).toHaveLength(2);
    expect(() => calculateTimeWeightedCostBasis(snapshots)).not.toThrow();
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(1000_000000n);
  });

  it('seeds from the first in-window event when no boundary event exists', () => {
    // A position whose recorded opening predates its first ledger event. The
    // gap is treated as fully deployed, matching the pre-change denominator.
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-01-01T00:00:00Z'),
      windowStartCostBasis: null,
      events: [
        { timestamp: t('2026-01-11T00:00:00Z'), costBasisAfter: 1000_000000n },
      ],
      asOf: t('2026-01-21T00:00:00Z'),
      currentCostBasis: 1000_000000n,
    });

    expect(snapshots[0]).toEqual({
      timestamp: t('2026-01-01T00:00:00Z'),
      costBasisAfter: 1000_000000n,
    });
    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(1000_000000n);
  });

  it('falls back to the current cost basis when there are no events at all', () => {
    const snapshots = buildUnrealizedWindowSnapshots({
      windowStart: t('2026-01-01T00:00:00Z'),
      windowStartCostBasis: null,
      events: [],
      asOf: t('2026-01-21T00:00:00Z'),
      currentCostBasis: 1000_000000n,
    });

    expect(calculateTimeWeightedCostBasis(snapshots)).toBe(1000_000000n);
  });
});
