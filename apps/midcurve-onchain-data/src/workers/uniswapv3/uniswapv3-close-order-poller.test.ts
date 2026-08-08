/**
 * CloseOrderSubscriber block-tracking heartbeat — unit tests
 *
 * Issue #89. The heartbeat used to persist the chain head every 60s without
 * scanning anything, so a restart resumed from wherever the head was at the
 * last heartbeat and silently skipped everything in between.
 *
 * The property under test is the one the defect violated: the heartbeat never
 * persists a block above what a poller has actually scanned. Asserted on the
 * persisted cursor value rather than on call arguments, because the whole
 * failure mode is that an unscanned range and an empty one look identical from
 * the outside — no error, no warn, no event count difference.
 *
 * No live Prisma. The database module is mocked with an in-memory cache table,
 * so the real CacheService and the real cursor helpers run against it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MODULE MOCKS
// =============================================================================

const { cacheRows, prismaMock, getBlockNumberMock } = vi.hoisted(() => {
  const cacheRows = new Map<string, { key: string; value: unknown; expiresAt: Date; updatedAt: Date }>();

  return {
    cacheRows,
    getBlockNumberMock: vi.fn<() => Promise<bigint>>(),
    prismaMock: {
      cache: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => cacheRows.get(where.key) ?? null),
        upsert: vi.fn(
          async ({
            where,
            create,
            update,
          }: {
            where: { key: string };
            create: { key: string; value: unknown; expiresAt: Date };
            update: { value: unknown; expiresAt: Date; updatedAt: Date };
          }) => {
            const existing = cacheRows.get(where.key);
            const row = existing
              ? { ...existing, ...update }
              : { ...create, updatedAt: new Date() };
            cacheRows.set(where.key, row);
            return row;
          }
        ),
        delete: vi.fn(async ({ where }: { where: { key: string } }) => {
          cacheRows.delete(where.key);
          return null;
        }),
      },
    },
  };
});

vi.mock('@midcurve/database', () => ({
  prisma: prismaMock,
}));

// EvmConfig is stubbed so that a chain-head read is both available and
// obviously distinguishable from the scanned watermark. Under the old
// heartbeat this is the value that got persisted.
vi.mock('@midcurve/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midcurve/services')>();
  return {
    ...actual,
    EvmConfig: {
      getInstance: () => ({
        getPublicClient: () => ({ getBlockNumber: getBlockNumberMock }),
      }),
    },
  };
});

import {
  getCloseOrderLastProcessedBlock,
  setCloseOrderLastProcessedBlock,
} from '../../catchup/close-order-catchup';
import { UniswapV3CloserPollingBatch } from '../../polling/uniswap-v3-closer';
import { CloseOrderSubscriber } from './uniswapv3-close-order-poller';

// =============================================================================
// FIXTURES
// =============================================================================

const CHAIN_ID = 42161;
const CLOSER_ADDRESS = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';

/** Where the chain is now. The heartbeat must never persist this. */
const CHAIN_HEAD = 250_000_000n;

/** What the poller has actually put through eth_getLogs. */
const SCANNED_BLOCK = 249_000_000n;

/**
 * The subscriber's internals. The heartbeat is private and driven by a timer in
 * production; a unit test reaches it directly rather than waiting 60s.
 */
interface SubscriberInternals {
  pollers: Array<{ chainId: number; getLastScannedBlock(): bigint | null }>;
  contractsByChain: Map<number, string[]>;
  updateBlockTrackingHeartbeat(): Promise<void>;
}

function subscriberWithPoller(scannedBlock: bigint | null): {
  subscriber: CloseOrderSubscriber;
  internals: SubscriberInternals;
} {
  const subscriber = new CloseOrderSubscriber();
  const internals = subscriber as unknown as SubscriberInternals;

  internals.pollers = [
    { chainId: CHAIN_ID, getLastScannedBlock: () => scannedBlock },
  ];
  // Populated on a real start(); the pre-fix heartbeat iterated this map.
  internals.contractsByChain = new Map([[CHAIN_ID, [CLOSER_ADDRESS]]]);

  return { subscriber, internals };
}

// =============================================================================
// TESTS
// =============================================================================

describe('CloseOrderSubscriber block-tracking heartbeat', () => {
  beforeEach(() => {
    cacheRows.clear();
    vi.clearAllMocks();
    getBlockNumberMock.mockResolvedValue(CHAIN_HEAD);
  });

  it('persists the scanned watermark, never the chain head', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, SCANNED_BLOCK);

    const { internals } = subscriberWithPoller(SCANNED_BLOCK);
    await internals.updateBlockTrackingHeartbeat();

    // The defect: this was CHAIN_HEAD, and a restart would resume from there,
    // skipping the ~1,000,000 blocks the poller had not yet looked at.
    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(SCANNED_BLOCK);
  });

  it('does not read the chain head at all', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, SCANNED_BLOCK);

    const { internals } = subscriberWithPoller(SCANNED_BLOCK);
    await internals.updateBlockTrackingHeartbeat();

    expect(getBlockNumberMock).not.toHaveBeenCalled();
  });

  it('advances the cursor when the poller has scanned further', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, SCANNED_BLOCK);

    const advanced = SCANNED_BLOCK + 5_000n;
    const { internals } = subscriberWithPoller(advanced);
    await internals.updateBlockTrackingHeartbeat();

    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(advanced);
  });

  it('never moves the cursor backwards', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, SCANNED_BLOCK);

    // Catch-up persists finalizedBlock, which trails the poller's watermark.
    const { internals } = subscriberWithPoller(SCANNED_BLOCK - 64n);
    await internals.updateBlockTrackingHeartbeat();

    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(SCANNED_BLOCK);
  });

  it('writes nothing for a poller that has not completed a scan', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, SCANNED_BLOCK);
    vi.clearAllMocks();

    const { internals } = subscriberWithPoller(null);
    await internals.updateBlockTrackingHeartbeat();

    expect(prismaMock.cache.upsert).not.toHaveBeenCalled();
    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(SCANNED_BLOCK);
  });

  it('leaves the cursor untouched when there is no cursor and no scan', async () => {
    const { internals } = subscriberWithPoller(null);
    await internals.updateBlockTrackingHeartbeat();

    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBeNull();
  });
});

describe('UniswapV3CloserPollingBatch scanned watermark', () => {
  beforeEach(() => {
    cacheRows.clear();
    vi.clearAllMocks();
    getBlockNumberMock.mockResolvedValue(CHAIN_HEAD);
  });

  it('reports no scanned block while seeded from the chain head', async () => {
    // No cached cursor, so start() seeds the polling position from the head.
    // Nothing has been scanned at that point.
    const batch = new UniswapV3CloserPollingBatch(CHAIN_ID, [
      { address: CLOSER_ADDRESS, chainId: CHAIN_ID },
    ]);

    await batch.start();

    try {
      expect(batch.getStatus().lastProcessedBlock).toBe(CHAIN_HEAD.toString());
      expect(batch.getLastScannedBlock()).toBeNull();
    } finally {
      await batch.stop();
    }
  });
});
