/**
 * createSourceEventKey / sourceEventKeyForCloseOrderEvent — unit tests
 *
 * The key is the contract between the two producers of close order events — the
 * fallback poller and publishCloseOrderEventsFromReceipt (it was three until #88
 * deleted the startup catch-up). If they ever disagree on a single character, a
 * replayed event stops being recognised as a replay and the duplicate row #79
 * removed comes back. So the shape is pinned here, along with the two cases that
 * must NOT produce a key.
 */

import { describe, it, expect } from 'vitest';
import {
  createSourceEventKey,
  sourceEventKeyForCloseOrderEvent,
} from './source-event-key.js';

const TX = '0x9f2c1a4b5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708';

describe('createSourceEventKey', () => {
  it('builds "{chainId}/{transactionHash}/{logIndex}"', () => {
    expect(
      createSourceEventKey({ chainId: 42161, transactionHash: TX, logIndex: 7 })
    ).toBe(`42161/${TX}/7`);
  });

  it('keeps logIndex 0 in the key rather than dropping it', () => {
    expect(
      createSourceEventKey({ chainId: 1, transactionHash: TX, logIndex: 0 })
    ).toBe(`1/${TX}/0`);
  });

  it('lowercases the transaction hash so casing cannot split one event in two', () => {
    const upper = createSourceEventKey({
      chainId: 42161,
      transactionHash: TX.toUpperCase().replace('0X', '0x'),
      logIndex: 7,
    });

    expect(upper).toBe(
      createSourceEventKey({ chainId: 42161, transactionHash: TX, logIndex: 7 })
    );
  });

  it('distinguishes logs within one transaction', () => {
    const a = createSourceEventKey({ chainId: 1, transactionHash: TX, logIndex: 3 });
    const b = createSourceEventKey({ chainId: 1, transactionHash: TX, logIndex: 4 });

    expect(a).not.toBe(b);
  });

  it('distinguishes the same log index across chains', () => {
    const a = createSourceEventKey({ chainId: 1, transactionHash: TX, logIndex: 3 });
    const b = createSourceEventKey({ chainId: 42161, transactionHash: TX, logIndex: 3 });

    expect(a).not.toBe(b);
  });
});

describe('sourceEventKeyForCloseOrderEvent', () => {
  it('derives the key from a complete envelope', () => {
    expect(
      sourceEventKeyForCloseOrderEvent({
        chainId: 42161,
        transactionHash: TX,
        logIndex: 12,
      })
    ).toBe(`42161/${TX}/12`);
  });

  it('derives a key when logIndex is 0', () => {
    expect(
      sourceEventKeyForCloseOrderEvent({
        chainId: 42161,
        transactionHash: TX,
        logIndex: 0,
      })
    ).toBe(`42161/${TX}/0`);
  });

  // Both of these would otherwise produce ".../null" or ".../undefined", which
  // collides with every other keyless event in the same transaction — turning a
  // dedupe into a silent deletion of rows that were never duplicates.
  it('returns undefined when logIndex is null', () => {
    expect(
      sourceEventKeyForCloseOrderEvent({
        chainId: 42161,
        transactionHash: TX,
        logIndex: null,
      })
    ).toBeUndefined();
  });

  it('returns undefined when the transaction hash is missing', () => {
    expect(
      sourceEventKeyForCloseOrderEvent({
        chainId: 42161,
        transactionHash: undefined,
        logIndex: 7,
      })
    ).toBeUndefined();
  });
});
