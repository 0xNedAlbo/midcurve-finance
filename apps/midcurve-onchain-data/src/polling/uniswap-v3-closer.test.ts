/**
 * Close order sweep and cursor — unit tests
 *
 * Issue #88. The scan was windowed into 10,000-block requests, a failed window
 * was swallowed and reported as "0 events found", a failed publish was skipped,
 * and the cursor advanced past all of it regardless.
 *
 * The properties under test are the ones those defects violated, and they are
 * asserted on the two things an operator can actually observe: the block range
 * that reached `eth_getLogs`, and the cursor value read back out of the cache.
 * Not on call counts alone — the whole failure mode is that an unscanned range
 * and an empty one look identical from the outside.
 *
 * No live Prisma and no live RPC. The database module is mocked with an
 * in-memory cache table so the real CacheService and the real cursor helpers run
 * against it, and the scan client's `request` is a stub.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MODULE MOCKS
// =============================================================================

const {
  cacheRows,
  prismaMock,
  getBlockNumberMock,
  requestMock,
  publishMock,
  buildCloseOrderEventMock,
} = vi.hoisted(() => {
  const cacheRows = new Map<string, { key: string; value: unknown; expiresAt: Date; updatedAt: Date }>();

  return {
    cacheRows,
    getBlockNumberMock: vi.fn<() => Promise<bigint>>(),
    requestMock: vi.fn<(args: unknown) => Promise<unknown>>(),
    publishMock: vi.fn<(routingKey: string, content: Buffer) => Promise<boolean>>(),
    buildCloseOrderEventMock: vi.fn(),
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
            const row = existing ? { ...existing, ...update } : { ...create, updatedAt: new Date() };
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

// The sweep builds its own long-timeout client (see getScanClient), so the stub
// goes on createPublicClient rather than on EvmConfig. TimeoutError stays real:
// the failure message branches on `instanceof`, and that branch is under test.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({ request: requestMock }),
  };
});

vi.mock('@midcurve/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midcurve/services')>();
  return {
    ...actual,
    closeOrderRoutingKeyForEvent: () => 'close-order.registered.42161',
    EvmConfig: {
      getInstance: () => ({
        getPublicClient: () => ({ getBlockNumber: getBlockNumberMock }),
        getChainConfig: () => ({ viemChain: undefined, rpcUrl: 'http://rpc.test' }),
      }),
    },
  };
});

vi.mock('../mq/connection-manager', () => ({
  getRabbitMQConnection: () => ({ publishCloseOrderEvent: publishMock }),
}));

vi.mock('../mq/close-order-messages', () => ({
  buildCloseOrderEvent: buildCloseOrderEventMock,
  serializeCloseOrderEvent: () => Buffer.from('{}'),
}));

import { TimeoutError } from 'viem';
import {
  fetchHistoricalCloseOrderEvents,
  getCloseOrderLastProcessedBlock,
  setCloseOrderLastProcessedBlock,
} from './close-order-scan';
import { UniswapV3CloserPollingBatch } from './uniswap-v3-closer';

// =============================================================================
// FIXTURES
// =============================================================================

const CHAIN_ID = 42161;
const CLOSER_ADDRESS = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const CHAIN_HEAD = 4_000_000n;

/** Where the cursor sits before a failing cycle. It must still be there after. */
const CURSOR = 3_000_000n;

const CONTRACTS = [{ address: CLOSER_ADDRESS, chainId: CHAIN_ID }];

/** One raw log, shaped as an RPC returns it. */
const RPC_LOG = {
  address: CLOSER_ADDRESS.toLowerCase(),
  topics: ['0xaaaa', '0xbbbb'],
  data: '0x',
  blockNumber: '0x2dc6c0', // 3_000_000
  transactionHash: '0x9f2c1a4b5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708',
  logIndex: '0x7',
};

const DOMAIN_EVENT = {
  type: 'close-order.registered',
  nftId: '12345',
  vaultAddress: undefined,
  ownerAddress: undefined,
  transactionHash: RPC_LOG.transactionHash,
  logIndex: 7,
};

/** The eth_getLogs params of the Nth call. */
function requestParams(call = 0): { fromBlock: string; toBlock: string } {
  const args = requestMock.mock.calls[call]![0] as {
    method: string;
    params: [{ fromBlock: string; toBlock: string }];
  };
  expect(args.method).toBe('eth_getLogs');
  return args.params[0];
}

/** A promise plus its resolvers, for holding a sweep open mid-flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  cacheRows.clear();
  vi.clearAllMocks();
  getBlockNumberMock.mockResolvedValue(CHAIN_HEAD);
  requestMock.mockResolvedValue([]);
  publishMock.mockResolvedValue(true);
  buildCloseOrderEventMock.mockReturnValue(DOMAIN_EVENT);
});

// =============================================================================
// THE SWEEP
// =============================================================================

describe('fetchHistoricalCloseOrderEvents', () => {
  it('scans the whole range in a single eth_getLogs call', async () => {
    await fetchHistoricalCloseOrderEvents({
      chainId: CHAIN_ID,
      contractAddresses: [CLOSER_ADDRESS],
      fromBlock: 0n,
      toBlock: CHAIN_HEAD,
    });

    // At the old 10,000-block window this range was 400 calls. The count alone
    // would pass with a window of 4,000,001, so the range is asserted too.
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestParams()).toMatchObject({
      fromBlock: '0x0',
      toBlock: `0x${CHAIN_HEAD.toString(16)}`,
    });
  });

  it('throws instead of reporting zero events when the request fails', async () => {
    requestMock.mockRejectedValue(new Error('query returned more than 10000 results'));

    await expect(
      fetchHistoricalCloseOrderEvents({
        chainId: CHAIN_ID,
        contractAddresses: [CLOSER_ADDRESS],
        fromBlock: 0n,
        toBlock: CHAIN_HEAD,
      })
    ).rejects.toThrow(/Alchemy Pay As You Go/);
  });

  it('keeps the provider error as the cause', async () => {
    const rpcError = new Error('query returned more than 10000 results');
    requestMock.mockRejectedValue(rpcError);

    await expect(
      fetchHistoricalCloseOrderEvents({
        chainId: CHAIN_ID,
        contractAddresses: [CLOSER_ADDRESS],
        fromBlock: 0n,
        toBlock: CHAIN_HEAD,
      })
    ).rejects.toMatchObject({ cause: rpcError });
  });

  it('does not blame the RPC plan when the request timed out', async () => {
    requestMock.mockRejectedValue(new TimeoutError({ body: {}, url: 'http://rpc.test' }));

    // A timeout is not a rejected range. Sending the reader to their Alchemy
    // tier over a request that was still running is a confidently wrong
    // diagnosis, which is worse than none.
    const error = await fetchHistoricalCloseOrderEvents({
      chainId: CHAIN_ID,
      contractAddresses: [CLOSER_ADDRESS],
      fromBlock: 0n,
      toBlock: CHAIN_HEAD,
    }).then(
      () => {
        throw new Error('expected the sweep to reject');
      },
      (e: Error) => e
    );

    expect(error.message).toMatch(/timed out/);
    expect(error.message).not.toMatch(/Alchemy|Pay As You Go|free-tier/);
  });
});

// =============================================================================
// THE CURSOR
// =============================================================================

describe('UniswapV3CloserPollingBatch cursor', () => {
  let batch: UniswapV3CloserPollingBatch;

  beforeEach(() => {
    batch = new UniswapV3CloserPollingBatch(CHAIN_ID, CONTRACTS);
  });

  afterEach(async () => {
    await batch.stop();
  });

  it('leaves the cursor where it was when the sweep fails', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, CURSOR);
    requestMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND rpc.invalid'));

    await batch.start();
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalled());

    // The defect: the range failed, and the cursor moved to the chain head
    // anyway, so those ~1,000,000 blocks were never looked at again.
    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(CURSOR);
    expect(batch.getLastScannedBlock()).toBeNull();
  });

  it('leaves the cursor where it was when a publish fails', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, CURSOR);
    requestMock.mockResolvedValue([RPC_LOG]);
    publishMock.mockRejectedValue(new Error('Channel closed'));

    await batch.start();
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalled());

    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(CURSOR);
    expect(batch.getLastScannedBlock()).toBeNull();
  });

  it('advances the cursor to the scanned head when the cycle succeeds', async () => {
    await setCloseOrderLastProcessedBlock(CHAIN_ID, CURSOR);
    requestMock.mockResolvedValue([RPC_LOG]);

    await batch.start();
    await vi.waitFor(async () =>
      expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(CHAIN_HEAD)
    );

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(requestParams()).toMatchObject({
      // cursor + 1: the block already scanned is not scanned again
      fromBlock: `0x${(CURSOR + 1n).toString(16)}`,
      toBlock: `0x${CHAIN_HEAD.toString(16)}`,
    });
  });

  it('scans from block 0 when there is no cursor', async () => {
    await batch.start();
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalled());

    // Asserted on the range that reached eth_getLogs, not on the poller having
    // started: seeding from the chain head would also "start" and would silently
    // never see an order registered before this process did.
    expect(requestParams()).toMatchObject({
      fromBlock: '0x0',
      toBlock: `0x${CHAIN_HEAD.toString(16)}`,
    });
    expect(getBlockNumberMock).toHaveBeenCalled();
  });

  it('does not make start() wait for the first sweep', async () => {
    const inFlight = deferred<unknown>();
    requestMock.mockReturnValue(inFlight.promise);

    await batch.start();

    // start() has resolved while the sweep is still open. Awaiting it here is
    // what would put a full-history backfill of chain N in front of chain N+1's
    // poller — Defect 3, rebuilt inside its own fix.
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(batch.getLastScannedBlock()).toBeNull();
    expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBeNull();

    inFlight.resolve([]);
    await vi.waitFor(async () =>
      expect(await getCloseOrderLastProcessedBlock(CHAIN_ID)).toBe(CHAIN_HEAD)
    );
  });
});
