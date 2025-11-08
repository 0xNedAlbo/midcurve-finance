/**
 * Unit tests for state management utilities
 */

import { describe, it, expect } from 'vitest';
import {
  buildInitialState,
  extractPreviousEventId,
  type PreviousEventState,
} from './state-builder.js';
import type { UniswapV3LedgerEvent } from '@midcurve/shared';

describe('buildInitialState', () => {
  it('should return zero state when no previous event exists', () => {
    const state = buildInitialState(undefined);

    const expected: PreviousEventState = {
      uncollectedPrincipal0: 0n,
      uncollectedPrincipal1: 0n,
      liquidity: 0n,
      costBasis: 0n,
      pnl: 0n,
    };

    expect(state).toEqual(expected);
  });

  it('should extract state from previous event', () => {
    const lastEvent = createMockLedgerEvent({
      uncollectedPrincipal0After: 1000000n,
      uncollectedPrincipal1After: 2000000n,
      liquidityAfter: 500000n,
      costBasisAfter: 10000000000000000000n, // 10 ETH
      pnlAfter: 5000000000000000000n, // 5 ETH
    });

    const state = buildInitialState(lastEvent);

    expect(state.uncollectedPrincipal0).toBe(1000000n);
    expect(state.uncollectedPrincipal1).toBe(2000000n);
    expect(state.liquidity).toBe(500000n);
    expect(state.costBasis).toBe(10000000000000000000n);
    expect(state.pnl).toBe(5000000000000000000n);
  });

  it('should handle zero values in previous event', () => {
    const lastEvent = createMockLedgerEvent({
      uncollectedPrincipal0After: 0n,
      uncollectedPrincipal1After: 0n,
      liquidityAfter: 0n,
      costBasisAfter: 0n,
      pnlAfter: 0n,
    });

    const state = buildInitialState(lastEvent);

    expect(state.uncollectedPrincipal0).toBe(0n);
    expect(state.uncollectedPrincipal1).toBe(0n);
    expect(state.liquidity).toBe(0n);
    expect(state.costBasis).toBe(0n);
    expect(state.pnl).toBe(0n);
  });

  it('should handle negative PnL', () => {
    const lastEvent = createMockLedgerEvent({
      pnlAfter: -1000000000000000000n, // -1 ETH loss
    });

    const state = buildInitialState(lastEvent);

    expect(state.pnl).toBe(-1000000000000000000n);
  });
});

describe('extractPreviousEventId', () => {
  it('should return null when no previous event exists', () => {
    const id = extractPreviousEventId(undefined);
    expect(id).toBeNull();
  });

  it('should extract event ID from previous event', () => {
    const lastEvent = createMockLedgerEvent({
      id: 'evt_abc123',
    });

    const id = extractPreviousEventId(lastEvent);

    expect(id).toBe('evt_abc123');
  });

  it('should handle empty string ID', () => {
    const lastEvent = createMockLedgerEvent({
      id: '',
    });

    const id = extractPreviousEventId(lastEvent);

    expect(id).toBe('');
  });
});

// Helper function to create mock ledger events
function createMockLedgerEvent(
  configOverrides: Partial<{
    id: string;
    uncollectedPrincipal0After: bigint;
    uncollectedPrincipal1After: bigint;
    liquidityAfter: bigint;
    costBasisAfter: bigint;
    pnlAfter: bigint;
  }> = {}
): UniswapV3LedgerEvent {
  return {
    id: configOverrides.id ?? 'evt_123',
    positionId: 'pos_123',
    positionLedgerEventType: 'uniswapv3',
    eventType: 'INCREASE_LIQUIDITY',
    blockNumber: 1000n,
    blockTimestamp: new Date('2024-01-01T00:00:00Z'),
    transactionHash: '0x1234',
    previousId: null,
    costBasisBefore: 0n,
    costBasisAfter: configOverrides.costBasisAfter ?? 0n,
    deltaCostBasis: 0n,
    pnlBefore: 0n,
    pnlAfter: configOverrides.pnlAfter ?? 0n,
    deltaPnl: 0n,
    inputHash: 'hash123',
    createdAt: new Date(),
    updatedAt: new Date(),
    config: {
      blockNumber: 1000n,
      transactionIndex: 0n,
      logIndex: 0n,
      amount0: 0n,
      amount1: 0n,
      liquidity: 0n,
      liquidityBefore: 0n,
      liquidityAfter: configOverrides.liquidityAfter ?? 0n,
      deltaL: 0n,
      uncollectedPrincipal0Before: 0n,
      uncollectedPrincipal0After: configOverrides.uncollectedPrincipal0After ?? 0n,
      uncollectedPrincipal1Before: 0n,
      uncollectedPrincipal1After: configOverrides.uncollectedPrincipal1After ?? 0n,
      amount0InQuote: 0n,
      amount1InQuote: 0n,
      poolPriceId: 'price_123',
    },
    state: {
      eventType: 'INCREASE_LIQUIDITY',
    },
  } as UniswapV3LedgerEvent;
}
