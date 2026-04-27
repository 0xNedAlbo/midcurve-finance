import { describe, it, expect } from 'vitest';
import { PoolSearchRequestSchema } from './pool-search.js';

/**
 * Pool search request validation — issue #45 same-token rejection.
 *
 * The schema rejects ONLY the trivial verbatim case:
 * `|base| = |quote| = 1 ∧ base[0] === quote[0]` (after EIP-55 normalization
 * for addresses, case-insensitive compare for symbols). Richer queries like
 * `base=["WETH","stETH"], quote=["WETH","stETH"]` pass — per-chain
 * self-exclusion in the service handles the cartesian product.
 */
describe('PoolSearchRequestSchema — trivial-case same-token rejection', () => {
  const baseValid = {
    chainIds: [1],
    sortBy: 'tvlUSD' as const,
    sortDirection: 'desc' as const,
    limit: 20,
  };

  it('accepts a normal query', () => {
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: ['WETH'],
      quote: ['USDC'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects |base|=|quote|=1 with identical symbol', () => {
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: ['WETH'],
      quote: ['WETH'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects |base|=|quote|=1 with case-different symbol (case-insensitive compare)', () => {
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: ['WETH'],
      quote: ['weth'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects |base|=|quote|=1 with same address in different cases (EIP-55 normalize)', () => {
    const lower = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const checksummed = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: [lower],
      quote: [checksummed],
    });
    expect(r.success).toBe(false);
  });

  it('accepts the WETH/stETH-on-both-sides shape (cartesian product yields valid pairs)', () => {
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: ['WETH', 'stETH'],
      quote: ['WETH', 'stETH'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts |base|=2, |quote|=1 even when the single quote is in base', () => {
    const r = PoolSearchRequestSchema.safeParse({
      ...baseValid,
      base: ['WETH', 'stETH'],
      quote: ['WETH'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty base or quote arrays (min(1))', () => {
    expect(
      PoolSearchRequestSchema.safeParse({ ...baseValid, base: [], quote: ['USDC'] }).success
    ).toBe(false);
    expect(
      PoolSearchRequestSchema.safeParse({ ...baseValid, base: ['WETH'], quote: [] }).success
    ).toBe(false);
  });

  it('preserves defaults for sortBy / sortDirection / limit when omitted', () => {
    const r = PoolSearchRequestSchema.safeParse({
      base: ['WETH'],
      quote: ['USDC'],
      chainIds: [1],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sortBy).toBe('tvlUSD');
      expect(r.data.sortDirection).toBe('desc');
      expect(r.data.limit).toBe(20);
    }
  });
});
