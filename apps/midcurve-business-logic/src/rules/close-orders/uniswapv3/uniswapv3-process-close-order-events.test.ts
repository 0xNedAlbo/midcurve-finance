/**
 * UniswapV3ProcessCloseOrderEventsRule — unit tests
 *
 * Issue #77 acceptance criteria, vault variant:
 *  1. Registering a stop-loss on a vault position creates exactly one row with
 *     protocol 'uniswapv3-vault', linked to the correct vault position
 *  2. Two owners on the same vault hold their own LOWER/UPPER slots
 *  3. Re-registration on an occupied slot replaces the previous order
 *  4. Cancellation removes the row and logs the cancellation
 *  5. Execution removes the row, preserves execution data, drops the subscription
 *  6. Trigger-tick, slippage, operator, payout, valid-until, swap-intent and
 *     shares updates land in the stored order
 *  7. Replaying the same event twice produces no duplicate rows
 * 10. A message no handler can process is dead-lettered, not acked
 *
 * No live RabbitMQ, no live Prisma. The database module is mocked and the rule's
 * own service instances are replaced after construction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MODULE MOCKS
// =============================================================================

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    position: {
      findUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
      findMany: vi.fn<(args: { where: Record<string, unknown> }) => Promise<Array<{ id: string; config: Record<string, unknown> }>>>(),
    },
  };
  return {
    txMock,
    prismaMock: {
      position: { findUnique: vi.fn(), findMany: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(txMock)),
    },
  };
});
vi.mock('@midcurve/database', () => ({
  prisma: prismaMock,
}));

import { ContractTriggerMode, ContractSwapDirection } from '@midcurve/shared';
import { getDomainEventPublisher } from '@midcurve/services';
import { UniswapV3ProcessCloseOrderEventsRule } from './uniswapv3-process-close-order-events';

// =============================================================================
// FIXTURES
// =============================================================================

const CHAIN_ID = 42161;
const VAULT = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const OWNER_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const OWNER_B = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const POOL = '0xC6962004f452bE9203591991D15f6b388e09E8D0';
const CLOSER = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const OPERATOR = '0x1111111111111111111111111111111111111111';
const PAYOUT = '0x2222222222222222222222222222222222222222';
const NFT_ID = '12345';

const VAULT_POSITION_A = 'pos_vault_owner_a';
const VAULT_POSITION_B = 'pos_vault_owner_b';
const NFT_POSITION = 'pos_nft';

const TRIGGER_TICK = -201_120;

function identityHash(owner: string, triggerMode: ContractTriggerMode): string {
  return `uniswapv3-vault/${CHAIN_ID}/${VAULT}/${owner}/${triggerMode}`;
}

/** Envelope shared by every vault event */
function vaultEnvelope(owner: string, triggerMode: 'LOWER' | 'UPPER' = 'LOWER') {
  return {
    chainId: CHAIN_ID,
    contractAddress: CLOSER,
    vaultAddress: VAULT,
    ownerAddress: owner,
    triggerMode,
    blockNumber: '300000000',
    transactionHash: '0xdeadbeef',
    logIndex: 3,
    receivedAt: '2026-08-08T00:00:00.000Z',
  };
}

function vaultRegistered(owner = OWNER_A, triggerMode: 'LOWER' | 'UPPER' = 'LOWER') {
  return {
    type: 'close-order.registered.uniswapv3-vault',
    ...vaultEnvelope(owner, triggerMode),
    payload: {
      owner,
      pool: POOL,
      operator: OPERATOR,
      payout: PAYOUT,
      triggerTick: TRIGGER_TICK,
      validUntil: '1800000000',
      slippageBps: 100,
      swapDirection: 'NONE',
      swapSlippageBps: 0,
      shares: '1000000000000000000',
    },
  } as never;
}

function nftRegistered() {
  return {
    type: 'close-order.registered.uniswapv3',
    chainId: CHAIN_ID,
    contractAddress: CLOSER,
    nftId: NFT_ID,
    triggerMode: 'LOWER',
    blockNumber: '300000000',
    transactionHash: '0xfeedface',
    logIndex: 1,
    receivedAt: '2026-08-08T00:00:00.000Z',
    payload: {
      owner: OWNER_A,
      pool: POOL,
      operator: OPERATOR,
      payout: PAYOUT,
      triggerTick: TRIGGER_TICK,
      validUntil: '1800000000',
      slippageBps: 100,
      swapDirection: 'NONE',
      swapSlippageBps: 0,
    },
  } as never;
}

function vaultEvent(type: string, payload: Record<string, unknown>, owner = OWNER_A) {
  return { type, ...vaultEnvelope(owner), payload } as never;
}

/** A stored CloseOrder row as the rule sees it */
function storedVaultOrder(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'ord_vault_1',
    protocol: 'uniswapv3-vault',
    positionId: VAULT_POSITION_A,
    orderIdentityHash: identityHash(OWNER_A, ContractTriggerMode.LOWER),
    closeOrderHash: 'sl@-201120',
    automationState: 'monitoring',
    config: { chainId: CHAIN_ID, vaultAddress: VAULT, ownerAddress: OWNER_A, triggerMode: ContractTriggerMode.LOWER, contractAddress: CLOSER },
    state: { triggerTick: TRIGGER_TICK, slippageBps: 100 },
    ...overrides,
  };
}

const VAULT_POSITION_CONFIG = {
  chainId: CHAIN_ID,
  vaultAddress: VAULT,
  ownerAddress: OWNER_A,
  poolAddress: POOL,
};

// =============================================================================
// SERVICE MOCKS
// =============================================================================

/** A position stand-in exposing what buildOrderTag reads */
const positionStub = {
  isToken0Quote: false,
  pool: { token0: { decimals: 18 }, token1: { decimals: 6 } },
};

type OrderRow = Record<string, unknown>;

/** The CreateCloseOrderInput shape, as the rule hands it to the service */
interface CreateInput {
  protocol: string;
  positionId: string;
  orderIdentityHash: string;
  closeOrderHash?: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

type FindOrder = (hash: string, tx?: unknown) => Promise<OrderRow | null>;
type UpsertOrder = (input: CreateInput, tx?: unknown) => Promise<OrderRow>;
type LogCall = (
  positionId: string,
  orderId: string,
  context: Record<string, unknown>,
  tx?: unknown,
) => Promise<void>;

function buildRule() {
  const order = {
    findByOrderIdentityHash: vi.fn<FindOrder>(async () => null),
    upsertByIdentityHash: vi.fn<UpsertOrder>(async (input) => ({
      ...storedVaultOrder(),
      id: 'ord_created',
      protocol: input.protocol,
      positionId: input.positionId,
      orderIdentityHash: input.orderIdentityHash,
    })),
    create: vi.fn(),
    delete: vi.fn(async () => undefined),
    mergeState: vi.fn(async () => storedVaultOrder()),
    updateCloseOrderHash: vi.fn(async () => storedVaultOrder()),
  };

  const log = {
    logOrderCreated: vi.fn<LogCall>(async () => undefined),
    logOrderRegistered: vi.fn<LogCall>(async () => undefined),
    logOrderCancelled: vi.fn<LogCall>(async () => undefined),
    logOrderExecuted: vi.fn<LogCall>(async () => undefined),
    logOrderModified: vi.fn<LogCall>(async () => undefined),
  };

  const subscription = {
    ensureOrderSubscription: vi.fn(async () => undefined),
    removeOrderSubscription: vi.fn(async () => undefined),
  };

  const nftPosition = { findById: vi.fn(async () => positionStub) };
  const vaultPosition = { findById: vi.fn(async () => positionStub) };

  const rule = new UniswapV3ProcessCloseOrderEventsRule({
    orderService: order as never,
    automationLogService: log as never,
    automationSubscriptionService: subscription as never,
    positionService: nftPosition as never,
    vaultPositionService: vaultPosition as never,
  });

  return { rule, mocks: { order, log, subscription, nftPosition, vaultPosition } };
}

function processEvent(rule: UniswapV3ProcessCloseOrderEventsRule, event: unknown): Promise<void> {
  return (rule as never as { processEvent(e: unknown): Promise<void> }).processEvent(event);
}

// =============================================================================
// TESTS
// =============================================================================

describe('UniswapV3ProcessCloseOrderEventsRule — vault orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
    txMock.position.findMany.mockResolvedValue([
      { id: VAULT_POSITION_A, config: VAULT_POSITION_CONFIG },
    ]);
    txMock.position.findUnique.mockResolvedValue({
      id: VAULT_POSITION_A,
      config: VAULT_POSITION_CONFIG,
    });
    Object.assign(getDomainEventPublisher(), { publishDirect: vi.fn(async () => undefined) });
  });

  // AC 1
  it('creates exactly one row with protocol uniswapv3-vault, linked to the vault position', async () => {
    const { rule, mocks } = buildRule();

    await processEvent(rule, vaultRegistered());

    expect(mocks.order.upsertByIdentityHash).toHaveBeenCalledTimes(1);
    const input = mocks.order.upsertByIdentityHash.mock.calls[0]![0];
    expect(input.protocol).toBe('uniswapv3-vault');
    expect(input.positionId).toBe(VAULT_POSITION_A);
    expect(input.orderIdentityHash).toBe(identityHash(OWNER_A, ContractTriggerMode.LOWER));
    expect(input.closeOrderHash).toBe(`sl@${TRIGGER_TICK}`);
    expect(input.config).toMatchObject({
      chainId: CHAIN_ID,
      vaultAddress: VAULT,
      ownerAddress: OWNER_A,
      triggerMode: ContractTriggerMode.LOWER,
      contractAddress: CLOSER,
    });
    // Shares stay a string end to end
    expect(input.state.shares).toBe('1000000000000000000');
  });

  it('matches the vault position on chain, vault address AND owner', async () => {
    const { rule } = buildRule();

    await processEvent(rule, vaultRegistered(OWNER_B));

    const where = txMock.position.findMany.mock.calls[0]![0].where;
    expect(where.protocol).toBe('uniswapv3-vault');
    expect(where.AND).toEqual([
      { config: { path: ['chainId'], equals: CHAIN_ID } },
      { config: { path: ['vaultAddress'], equals: VAULT } },
      { config: { path: ['ownerAddress'], equals: OWNER_B } },
    ]);
  });

  // AC 2
  it('gives two owners on the same vault their own slots', async () => {
    const { rule, mocks } = buildRule();
    txMock.position.findMany
      .mockResolvedValueOnce([{ id: VAULT_POSITION_A, config: VAULT_POSITION_CONFIG }])
      .mockResolvedValueOnce([{ id: VAULT_POSITION_B, config: { ...VAULT_POSITION_CONFIG, ownerAddress: OWNER_B } }]);

    await processEvent(rule, vaultRegistered(OWNER_A));
    await processEvent(rule, vaultRegistered(OWNER_B));

    const hashes = mocks.order.upsertByIdentityHash.mock.calls.map((c) => c[0]!.orderIdentityHash);
    expect(hashes).toEqual([
      identityHash(OWNER_A, ContractTriggerMode.LOWER),
      identityHash(OWNER_B, ContractTriggerMode.LOWER),
    ]);
    expect(new Set(hashes).size).toBe(2);

    const positionIds = mocks.order.upsertByIdentityHash.mock.calls.map((c) => c[0]!.positionId);
    expect(positionIds).toEqual([VAULT_POSITION_A, VAULT_POSITION_B]);
  });

  it('gives LOWER and UPPER their own slots on one position', async () => {
    const { rule, mocks } = buildRule();

    await processEvent(rule, vaultRegistered(OWNER_A, 'LOWER'));
    await processEvent(rule, vaultRegistered(OWNER_A, 'UPPER'));

    const hashes = mocks.order.upsertByIdentityHash.mock.calls.map((c) => c[0]!.orderIdentityHash);
    expect(hashes).toEqual([
      identityHash(OWNER_A, ContractTriggerMode.LOWER),
      identityHash(OWNER_A, ContractTriggerMode.UPPER),
    ]);
  });

  // AC 3
  it('replaces the previous order when re-registering on an occupied slot', async () => {
    const { rule, mocks } = buildRule();
    const stale = storedVaultOrder({ id: 'ord_old', automationState: 'failed' });
    mocks.order.findByOrderIdentityHash.mockResolvedValueOnce(stale);

    await processEvent(rule, vaultRegistered());

    expect(mocks.order.delete).toHaveBeenCalledWith('ord_old', txMock);
    expect(mocks.order.upsertByIdentityHash).toHaveBeenCalledTimes(1);
    expect(mocks.order.upsertByIdentityHash.mock.calls[0]![0].orderIdentityHash).toBe(
      identityHash(OWNER_A, ContractTriggerMode.LOWER),
    );
  });

  // AC 7
  it('does not create a second row when the same registration is replayed', async () => {
    const { rule, mocks } = buildRule();
    mocks.order.findByOrderIdentityHash.mockResolvedValueOnce(
      storedVaultOrder({ automationState: 'monitoring' }),
    );

    await processEvent(rule, vaultRegistered());

    expect(mocks.order.upsertByIdentityHash).not.toHaveBeenCalled();
    expect(mocks.order.delete).not.toHaveBeenCalled();
    expect(mocks.log.logOrderCreated).not.toHaveBeenCalled();
  });

  // AC 4
  it('deletes the row and logs the cancellation on OrderCancelled', async () => {
    const { rule, mocks } = buildRule();
    mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

    await processEvent(rule, vaultEvent('close-order.cancelled.uniswapv3-vault', { owner: OWNER_A }));

    expect(mocks.log.logOrderCancelled).toHaveBeenCalledTimes(1);
    expect(mocks.order.delete).toHaveBeenCalledWith('ord_vault_1', txMock);
    expect(mocks.subscription.removeOrderSubscription).toHaveBeenCalledWith('ord_vault_1');
  });

  // AC 5
  it('deletes the row, preserves execution data and drops the subscription on OrderExecuted', async () => {
    const { rule, mocks } = buildRule();
    mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

    await processEvent(
      rule,
      vaultEvent('close-order.executed.uniswapv3-vault', {
        owner: OWNER_A,
        payout: PAYOUT,
        executionTick: TRIGGER_TICK,
        sharesClosed: '1000000000000000000',
        amount0Out: '500',
        amount1Out: '600',
      }),
    );

    expect(mocks.log.logOrderExecuted).toHaveBeenCalledTimes(1);
    const context = mocks.log.logOrderExecuted.mock.calls[0]![2] as Record<string, unknown>;
    expect(context.amount0Out).toBe('500');
    expect(context.amount1Out).toBe('600');
    // The row is deleted right after — the log is the only place the vault
    // quantity survives, so it has to reach the context (string, not bigint)
    expect(context.sharesClosed).toBe('1000000000000000000');
    expect(mocks.order.delete).toHaveBeenCalledWith('ord_vault_1', txMock);
    expect(mocks.subscription.removeOrderSubscription).toHaveBeenCalledWith('ord_vault_1');
  });

  it('omits sharesClosed for an NFT execution rather than writing a placeholder', async () => {
    const { rule, mocks } = buildRule();
    mocks.order.findByOrderIdentityHash.mockResolvedValue(
      storedVaultOrder({ protocol: 'uniswapv3' }),
    );

    await processEvent(rule, {
      type: 'close-order.executed.uniswapv3',
      chainId: CHAIN_ID,
      contractAddress: CLOSER,
      nftId: NFT_ID,
      triggerMode: 'LOWER',
      blockNumber: '300000000',
      transactionHash: '0xfeedface',
      logIndex: 1,
      receivedAt: '2026-08-08T00:00:00.000Z',
      payload: {
        owner: OWNER_A,
        payout: PAYOUT,
        executionTick: TRIGGER_TICK,
        amount0Out: '500',
        amount1Out: '600',
      },
    } as never);

    const context = mocks.log.logOrderExecuted.mock.calls[0]![2] as Record<string, unknown>;
    expect('sharesClosed' in context).toBe(false);
  });

  // AC 6
  describe('config updates land in the stored order', () => {
    it('operator', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.operator-updated.uniswapv3-vault', {
          oldOperator: OPERATOR,
          newOperator: OWNER_B,
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith('ord_vault_1', { operatorAddress: OWNER_B }, txMock);
    });

    it('payout', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.payout-updated.uniswapv3-vault', {
          oldPayout: PAYOUT,
          newPayout: OWNER_B,
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith('ord_vault_1', { payoutAddress: OWNER_B }, txMock);
    });

    it('trigger tick, recalculating the closeOrderHash', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.trigger-tick-updated.uniswapv3-vault', {
          oldTick: TRIGGER_TICK,
          newTick: -100,
        }),
      );

      expect(mocks.order.updateCloseOrderHash).toHaveBeenCalledWith(
        'ord_vault_1',
        'sl@-100',
        { triggerTick: -100 },
        txMock,
      );
    });

    it('valid-until', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.valid-until-updated.uniswapv3-vault', {
          oldValidUntil: '1800000000',
          newValidUntil: '1900000000',
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith(
        'ord_vault_1',
        { validUntil: new Date(1_900_000_000 * 1000).toISOString() },
        txMock,
      );
    });

    it('slippage', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.slippage-updated.uniswapv3-vault', {
          oldSlippageBps: 100,
          newSlippageBps: 250,
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith('ord_vault_1', { slippageBps: 250 }, txMock);
    });

    it('swap intent', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.swap-intent-updated.uniswapv3-vault', {
          oldDirection: 'NONE',
          newDirection: 'TOKEN0_TO_1',
          swapSlippageBps: 50,
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith(
        'ord_vault_1',
        { swapDirection: ContractSwapDirection.TOKEN0_TO_1, swapSlippageBps: 50 },
        txMock,
      );
    });

    it('shares (vault only), kept as a string', async () => {
      const { rule, mocks } = buildRule();
      mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

      await processEvent(
        rule,
        vaultEvent('close-order.shares-updated.uniswapv3-vault', {
          oldShares: '1000000000000000000',
          newShares: '2500000000000000000',
        }),
      );

      expect(mocks.order.mergeState).toHaveBeenCalledWith(
        'ord_vault_1',
        { shares: '2500000000000000000' },
        txMock,
      );
      expect(mocks.log.logOrderModified).toHaveBeenCalledTimes(1);
    });
  });

  it('builds the order tag from the vault position, not the NFT position service', async () => {
    const { rule, mocks } = buildRule();
    mocks.order.findByOrderIdentityHash.mockResolvedValue(storedVaultOrder());

    await processEvent(rule, vaultEvent('close-order.cancelled.uniswapv3-vault', { owner: OWNER_A }));

    expect(mocks.vaultPosition.findById).toHaveBeenCalledWith(VAULT_POSITION_A, txMock);
    expect(mocks.nftPosition.findById).not.toHaveBeenCalled();
  });

  it('skips an event for a share holder we do not track, without writing anything', async () => {
    const { rule, mocks } = buildRule();
    txMock.position.findMany.mockResolvedValue([]);

    await processEvent(rule, vaultRegistered(OWNER_B));

    expect(mocks.order.upsertByIdentityHash).not.toHaveBeenCalled();
    expect(mocks.log.logOrderCreated).not.toHaveBeenCalled();
  });

  it('refuses to guess when several positions match the same vault and owner', async () => {
    const { rule } = buildRule();
    txMock.position.findMany.mockResolvedValue([
      { id: VAULT_POSITION_A, config: VAULT_POSITION_CONFIG },
      { id: VAULT_POSITION_B, config: VAULT_POSITION_CONFIG },
    ]);

    await expect(processEvent(rule, vaultRegistered())).rejects.toThrow(/Ambiguous vault position/);
  });
});

describe('UniswapV3ProcessCloseOrderEventsRule — NFT orders still work', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
    txMock.position.findMany.mockResolvedValue([
      { id: NFT_POSITION, config: { chainId: CHAIN_ID, nftId: Number(NFT_ID), poolAddress: POOL } },
    ]);
    Object.assign(getDomainEventPublisher(), { publishDirect: vi.fn(async () => undefined) });
  });

  it('keeps the NFT identity hash unchanged (no addresses, no migration)', async () => {
    const { rule, mocks } = buildRule();

    await processEvent(rule, nftRegistered());

    const input = mocks.order.upsertByIdentityHash.mock.calls[0]![0];
    expect(input.protocol).toBe('uniswapv3');
    expect(input.orderIdentityHash).toBe(`uniswapv3/${CHAIN_ID}/${NFT_ID}/${ContractTriggerMode.LOWER}`);
    expect(input.config).toMatchObject({ chainId: CHAIN_ID, nftId: NFT_ID, contractAddress: CLOSER });
    expect(input.state.shares).toBeUndefined();
  });
});

// AC 10
describe('UniswapV3ProcessCloseOrderEventsRule — unroutable messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txMock));
  });

  it('throws on an event type no handler covers', async () => {
    const { rule } = buildRule();

    await expect(
      processEvent(rule, { type: 'close-order.teleported.uniswapv3-vault', chainId: CHAIN_ID }),
    ).rejects.toThrow(/Unknown close order event type/);
  });

  it('throws on an event carrying neither nftId nor vaultAddress', async () => {
    const { rule } = buildRule();

    await expect(
      processEvent(rule, {
        type: 'close-order.cancelled.uniswapv3',
        chainId: CHAIN_ID,
        triggerMode: 'LOWER',
        transactionHash: '0xabc',
        payload: { owner: OWNER_A },
      }),
    ).rejects.toThrow(/neither nftId nor vaultAddress/);
  });

  it('dead-letters instead of acking when a message cannot be processed', async () => {
    const { rule } = buildRule();
    const channel = { ack: vi.fn(), nack: vi.fn() };
    (rule as never as Record<string, unknown>).channel = channel;

    const msg = {
      content: Buffer.from(JSON.stringify({ type: 'close-order.teleported.uniswapv3-vault' })),
      fields: { routingKey: 'closer.vault.42161.0xabc.0' },
    };

    await (rule as never as { handleMessage(m: unknown): Promise<void> }).handleMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('acks an event that is understood but does not concern us', async () => {
    const { rule, mocks } = buildRule();
    const channel = { ack: vi.fn(), nack: vi.fn() };
    (rule as never as Record<string, unknown>).channel = channel;
    mocks.order.findByOrderIdentityHash.mockResolvedValue(null);

    const msg = {
      content: Buffer.from(
        JSON.stringify(vaultEvent('close-order.cancelled.uniswapv3-vault', { owner: OWNER_A })),
      ),
      fields: { routingKey: `closer.vault.${CHAIN_ID}.${VAULT}.0` },
    };

    await (rule as never as { handleMessage(m: unknown): Promise<void> }).handleMessage(msg);

    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(mocks.order.delete).not.toHaveBeenCalled();
  });
});
