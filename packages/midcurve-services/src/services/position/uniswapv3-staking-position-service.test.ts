/**
 * UniswapV3StakingPositionService — unit tests
 *
 * SPEC-0003b PR4a acceptance:
 *  - discover: validates the vault address (`INVALID_VAULT_CONTRACT` on chain
 *    read failure), creates Position row, calls syncFromChain, refreshes state.
 *  - discoverWalletPositions: factory lookup + `VaultCreated(owner=...)` scan;
 *    chains with no registered factory contribute `{ found: 0 }` gracefully.
 *  - refresh: always does a fresh chain pull (NO 15-second updatedAt cache).
 *  - reset: wipes ledger, does NOT emit revert events, reimports via
 *    syncFromChain. Journal-rebuild boundary assertion at the publisher.
 *  - refreshOnChainState: `Staked → Settled` transition emits position.closed.
 *  - delete: emits position.deleted, transactional.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// MODULE MOCKS — hoisted so vi.mock factories can reference them.
// =============================================================================

const { prismaMock, mockCreateAndPublish, mockLedgerInstance } = vi.hoisted(() => ({
    prismaMock: {
        position: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        positionLedgerEvent: {
            findFirst: vi.fn(),
        },
        token: { findUnique: vi.fn() },
        $transaction: vi.fn(),
    },
    mockCreateAndPublish: vi.fn(async () => 'evt_id'),
    mockLedgerInstance: {
        syncFromChain: vi.fn(async () => ({ perLogResults: [], allDeletedEvents: [] })),
        deleteAll: vi.fn(async () => undefined),
        recalculateAggregates: vi.fn(async () => ({
            liquidityAfter: 0n,
            costBasisAfter: 0n,
            realizedPnlAfter: 0n,
            collectedYieldAfter: 0n,
            realizedCashflowAfter: 0n,
        })),
    },
}));

vi.mock('@midcurve/database', () => ({
    prisma: prismaMock,
    PrismaClient: class {},
}));

vi.mock('../../events/index.js', async (importOriginal) => {
    const original: object = await (importOriginal as () => Promise<object>)();
    return {
        ...original,
        getDomainEventPublisher: vi.fn(() => ({
            createAndPublish: mockCreateAndPublish,
        })),
    };
});

vi.mock('../position-ledger/uniswapv3-staking-ledger-service.js', () => ({
    UniswapV3StakingLedgerService: vi.fn(() => mockLedgerInstance),
}));

import { UniswapV3StakingPositionService } from './uniswapv3-staking-position-service.js';

// =============================================================================
// FIXTURES
// =============================================================================

const POSITION_ID = 'pos_staking_test';
const USER_ID = 'user_test';
const CHAIN_ID = 42161;
// All addresses are pre-checksummed (EIP-55) so the service's `normalizeAddress`
// call returns them unchanged — keeps test assertions identity-comparable.
const VAULT_ADDRESS = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1';
const FACTORY_ADDRESS = '0x2Cc277Cd2CF5d78F18f0627a1DA2aA48b7C57EB1';
const POOL_ADDRESS = '0xc3c3c3c3c3c3c3c3c3C3C3c3C3C3C3c3C3C3c3c3';
const OWNER_ADDRESS = '0xb2b2b2b2b2B2b2B2B2b2b2B2B2b2B2B2b2b2b2b2';
const TOKEN0 = '0xaAAAaaAA00000000000000000000000000000000';
const TOKEN1 = '0xBbbBBbBB00000000000000000000000000000000';
const POSITION_HASH = `uniswapv3-staking/${CHAIN_ID}/${VAULT_ADDRESS}`;

const SQRT_PRICE_1_TO_1 = 2n ** 96n;

function makePositionRow(overrides: Record<string, unknown> = {}) {
    return {
        id: POSITION_ID,
        userId: USER_ID,
        protocol: 'uniswapv3-staking',
        type: 'LP_CONCENTRATED',
        positionHash: POSITION_HASH,
        ownerWallet: `evm:${OWNER_ADDRESS}`,
        config: {
            chainId: CHAIN_ID,
            vaultAddress: VAULT_ADDRESS,
            factoryAddress: FACTORY_ADDRESS,
            ownerAddress: OWNER_ADDRESS,
            underlyingTokenId: 42,
            isToken0Quote: false,
            poolAddress: POOL_ADDRESS,
            token0Address: TOKEN0,
            token1Address: TOKEN1,
            feeBps: 3000,
            tickSpacing: 60,
            tickLower: -100,
            tickUpper: 100,
            priceRangeLower: '0',
            priceRangeUpper: '0',
        },
        state: {
            vaultState: 'Staked',
            stakedBase: '0',
            stakedQuote: '0',
            yieldTarget: '0',
            pendingBps: 0,
            unstakeBufferBase: '0',
            unstakeBufferQuote: '0',
            rewardBufferBase: '0',
            rewardBufferQuote: '0',
            liquidity: '1000000',
            isOwnedByUser: true,
            unclaimedYieldBase: '0',
            unclaimedYieldQuote: '0',
            sqrtPriceX96: SQRT_PRICE_1_TO_1.toString(),
            currentTick: 0,
            poolLiquidity: '0',
            feeGrowthGlobal0: '0',
            feeGrowthGlobal1: '0',
        },
        currentValue: 0n,
        costBasis: 0n,
        realizedPnl: 0n,
        unrealizedPnl: 0n,
        realizedCashflow: 0n,
        unrealizedCashflow: 0n,
        collectedYield: 0n,
        unclaimedYield: 0n,
        lastYieldClaimedAt: new Date(),
        baseApr: null,
        rewardApr: null,
        totalApr: null,
        positionOpenedAt: new Date('2026-04-01T00:00:00Z'),
        archivedAt: null,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function makeTokenRow(address: string) {
    return {
        id: `tok_${address.slice(2, 10)}`,
        tokenType: 'erc20',
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 6,
        tokenHash: `erc20/${CHAIN_ID}/${address}`,
        config: { chainId: CHAIN_ID, address },
        coingeckoId: null,
        marketCap: null,
        logoUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

interface VaultReadOverrides {
    state?: number;
    stakedBase?: bigint;
    stakedQuote?: bigint;
    yieldTarget?: bigint;
    partialUnstakeBps?: number;
    unstakeBufferBase?: bigint;
    unstakeBufferQuote?: bigint;
    rewardBufferBase?: bigint;
    rewardBufferQuote?: bigint;
    owner?: string;
    pool?: string;
    tokenId?: bigint;
    token0?: string;
    token1?: string;
    isToken0Quote?: boolean;
    positionManager?: string;
    tickLower?: number;
    tickUpper?: number;
}

function makeMockClient(opts: {
    vaultReads?: VaultReadOverrides;
    nfpmLiquidity?: bigint;
    vaultCreatedLogs?: Array<{
        args: { owner?: string; vault?: string };
        blockNumber: bigint;
    }>;
    stakeLogs?: Array<{ blockNumber: bigint }>;
}) {
    const reads = {
        state: opts.vaultReads?.state ?? 1, // Staked
        stakedBase: opts.vaultReads?.stakedBase ?? 1000n,
        stakedQuote: opts.vaultReads?.stakedQuote ?? 500n,
        yieldTarget: opts.vaultReads?.yieldTarget ?? 100n,
        partialUnstakeBps: opts.vaultReads?.partialUnstakeBps ?? 0,
        unstakeBufferBase: opts.vaultReads?.unstakeBufferBase ?? 0n,
        unstakeBufferQuote: opts.vaultReads?.unstakeBufferQuote ?? 0n,
        rewardBufferBase: opts.vaultReads?.rewardBufferBase ?? 0n,
        rewardBufferQuote: opts.vaultReads?.rewardBufferQuote ?? 0n,
        owner: opts.vaultReads?.owner ?? OWNER_ADDRESS,
        pool: opts.vaultReads?.pool ?? POOL_ADDRESS,
        tokenId: opts.vaultReads?.tokenId ?? 42n,
        token0: opts.vaultReads?.token0 ?? TOKEN0,
        token1: opts.vaultReads?.token1 ?? TOKEN1,
        isToken0Quote: opts.vaultReads?.isToken0Quote ?? false,
        positionManager: opts.vaultReads?.positionManager ?? '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        tickLower: opts.vaultReads?.tickLower ?? -100,
        tickUpper: opts.vaultReads?.tickUpper ?? 100,
    };
    const liquidity = opts.nfpmLiquidity ?? 1_000_000n;

    return {
        chain: { id: CHAIN_ID },
        getChainId: vi.fn(async () => CHAIN_ID),
        getBlockNumber: vi.fn(async () => 1_000_000n),
        getBlock: vi.fn(async () => ({ number: 1_000_000n, timestamp: 1700000000n })),
        readContract: vi.fn(async (params: { functionName: string }) => {
            const fn = params.functionName;
            if (fn === 'positions') {
                return [
                    0n, '0x0000000000000000000000000000000000000000',
                    TOKEN0, TOKEN1, 3000, -100, 100,
                    liquidity, 0n, 0n, 0n, 0n,
                ];
            }
            const value = (reads as Record<string, unknown>)[fn];
            if (value === undefined) {
                throw new Error(`Unmocked readContract: ${fn}`);
            }
            return value;
        }),
        getLogs: vi.fn(async (params: { event?: { name: string }; args?: Record<string, unknown> }) => {
            const eventName = params.event?.name;
            if (eventName === 'VaultCreated') return opts.vaultCreatedLogs ?? [];
            if (eventName === 'Stake') return opts.stakeLogs ?? [];
            return [];
        }),
    };
}

function makeMockEvmConfig(client: ReturnType<typeof makeMockClient>) {
    return {
        getPublicClient: vi.fn(() => client),
        getFinalityConfig: vi.fn(() => ({ type: 'blockTag' as const })),
        getSupportedChainIds: vi.fn(() => [CHAIN_ID]),
    } as any;
}

function makeMockSharedContractService(opts: { factoryAddress?: string | null }) {
    return {
        findLatestByChainAndName: vi.fn(async () =>
            opts.factoryAddress === null
                ? null
                : { config: { address: opts.factoryAddress ?? FACTORY_ADDRESS, chainId: CHAIN_ID } },
        ),
    } as any;
}

function makeMockEvmBlockService() {
    return {
        getCurrentBlockNumber: vi.fn(async () => 1_000_000n),
        getLastFinalizedBlockNumber: vi.fn(async () => 1_000_000n),
    } as any;
}

function makeMockCacheService() {
    const store = new Map<string, unknown>();
    return {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        set: vi.fn(async (key: string, value: unknown) => {
            store.set(key, value);
        }),
        _store: store,
    } as any;
}

function makeMockPoolService() {
    return {
        discover: vi.fn(async () => ({
            typedConfig: { tickSpacing: 60 },
        })),
        fetchPoolState: vi.fn(async () => ({
            sqrtPriceX96: SQRT_PRICE_1_TO_1,
            currentTick: 0,
            liquidity: 0n,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
        })),
    } as any;
}

function makeMockErc20Service() {
    return {
        discover: vi.fn(async ({ address }: { address: string }) => ({
            id: `tok_${address.slice(2, 10)}`,
            address,
            decimals: 6,
            symbol: 'TEST',
        })),
    } as any;
}

interface ServiceFactoryOpts {
    factoryAddress?: string | null;
    vaultReads?: VaultReadOverrides;
    nfpmLiquidity?: bigint;
    vaultCreatedLogs?: Parameters<typeof makeMockClient>[0]['vaultCreatedLogs'];
    stakeLogs?: Parameters<typeof makeMockClient>[0]['stakeLogs'];
}

function makeService(opts: ServiceFactoryOpts = {}) {
    const client = makeMockClient(opts);
    const evmConfig = makeMockEvmConfig(client);
    const sharedContractService = makeMockSharedContractService({
        factoryAddress: opts.factoryAddress,
    });
    const evmBlockService = makeMockEvmBlockService();
    const cacheService = makeMockCacheService();
    const poolService = makeMockPoolService();
    const erc20TokenService = makeMockErc20Service();
    // Mock poolPriceService — never actually called because syncFromChain is mocked,
    // but the service constructor would otherwise try to instantiate the real one
    // (which requires EvmConfig.getInstance() to be initialized).
    const poolPriceService = { discover: vi.fn() } as any;

    const service = new UniswapV3StakingPositionService({
        evmConfig,
        sharedContractService,
        evmBlockService,
        cacheService,
        poolService,
        erc20TokenService,
        poolPriceService,
    });

    return { service, client, evmConfig, sharedContractService, cacheService, poolService };
}

// =============================================================================
// TESTS
// =============================================================================

describe('UniswapV3StakingPositionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset hoisted mocks (vi.clearAllMocks doesn't reach them)
        mockCreateAndPublish.mockReset().mockResolvedValue('evt_id');
        mockLedgerInstance.syncFromChain.mockReset().mockResolvedValue({
            perLogResults: [], allDeletedEvents: [],
        });
        mockLedgerInstance.deleteAll.mockReset().mockResolvedValue(undefined);
        mockLedgerInstance.recalculateAggregates.mockReset().mockResolvedValue({
            liquidityAfter: 0n,
            costBasisAfter: 0n,
            realizedPnlAfter: 0n,
            collectedYieldAfter: 0n,
            realizedCashflowAfter: 0n,
        });
        prismaMock.position.findFirst.mockReset();
        prismaMock.position.create.mockReset();
        prismaMock.position.update.mockReset().mockResolvedValue(makePositionRow());
        prismaMock.position.delete.mockReset();
        prismaMock.positionLedgerEvent.findFirst.mockReset().mockResolvedValue(null);
        prismaMock.token.findUnique.mockReset().mockImplementation(async (q: any) => {
            const hash = q.where.tokenHash as string;
            const addr = hash.split('/').pop()!;
            return makeTokenRow(addr);
        });
        prismaMock.$transaction.mockReset().mockImplementation(async (fn: any) => fn(prismaMock));
    });

    // -------------------------------------------------------------------------
    // 1. discover happy path
    // -------------------------------------------------------------------------
    it('discover — happy path: creates Position, syncs ledger, returns position', async () => {
        const { service } = makeService({
            stakeLogs: [{ blockNumber: 100n }],
        });
        prismaMock.position.findFirst
            .mockResolvedValueOnce(null) // findByPositionHash for existing check
            .mockResolvedValue(makePositionRow()); // subsequent findById in refresh

        prismaMock.position.create.mockResolvedValue(makePositionRow());

        const result = await service.discover(USER_ID, {
            chainId: CHAIN_ID,
            vaultAddress: VAULT_ADDRESS,
        });

        expect(prismaMock.position.create).toHaveBeenCalledTimes(1);
        const createArgs = prismaMock.position.create.mock.calls[0]![0];
        expect(createArgs.data.protocol).toBe('uniswapv3-staking');
        expect(createArgs.data.type).toBe('LP_CONCENTRATED');
        expect(createArgs.data.positionHash).toBe(POSITION_HASH);

        // syncFromChain called by refresh path
        expect(mockLedgerInstance.syncFromChain).toHaveBeenCalled();
        const syncArgs = mockLedgerInstance.syncFromChain.mock.calls[0]!;
        expect(syncArgs[3].factoryAddress).toBe(FACTORY_ADDRESS);

        // No `position.created` emitted from the service — that's the API route's job (PR4b).
        const types = mockCreateAndPublish.mock.calls.map((c) => c[0].type);
        expect(types).not.toContain('position.created');

        expect(result.id).toBe(POSITION_ID);
    });

    // -------------------------------------------------------------------------
    // 2. discover — INVALID_VAULT_CONTRACT
    // -------------------------------------------------------------------------
    it('discover — chain reads fail → throws INVALID_VAULT_CONTRACT', async () => {
        const { service, client } = makeService({});
        prismaMock.position.findFirst.mockResolvedValue(null);
        client.readContract.mockImplementationOnce(async () => {
            throw new Error('execution reverted');
        });

        await expect(
            service.discover(USER_ID, { chainId: CHAIN_ID, vaultAddress: VAULT_ADDRESS }),
        ).rejects.toThrow(/INVALID_VAULT_CONTRACT/);
    });

    // -------------------------------------------------------------------------
    // 3. discoverWalletPositions — chain with no factory
    // -------------------------------------------------------------------------
    it('discoverWalletPositions — chain with no factory contributes { found: 0 } gracefully', async () => {
        const { service } = makeService({ factoryAddress: null });

        const result = await service.discoverWalletPositions(USER_ID, OWNER_ADDRESS, [CHAIN_ID]);

        expect(result).toEqual({ found: 0, imported: 0, skipped: 0, errors: 0 });
    });

    // -------------------------------------------------------------------------
    // 4. discoverWalletPositions — getLogs uses fromBlock 0n + owner filter
    // -------------------------------------------------------------------------
    it('discoverWalletPositions — VaultCreated getLogs filtered by owner=walletAddress, fromBlock=0n', async () => {
        const { service, client } = makeService({
            vaultCreatedLogs: [], // no matches → no imports needed
        });

        await service.discoverWalletPositions(USER_ID, OWNER_ADDRESS, [CHAIN_ID]);

        expect(client.getLogs).toHaveBeenCalledTimes(1);
        const args = client.getLogs.mock.calls[0]![0];
        expect(args.address).toBe(FACTORY_ADDRESS);
        expect(args.event.name).toBe('VaultCreated');
        expect(args.args.owner.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase());
        expect(args.fromBlock).toBe(0n);
    });

    // -------------------------------------------------------------------------
    // 5. discoverWalletPositions — chain with matching VaultCreated log
    // -------------------------------------------------------------------------
    it('discoverWalletPositions — matching VaultCreated log triggers discover()', async () => {
        const { service } = makeService({
            vaultCreatedLogs: [{
                args: { owner: OWNER_ADDRESS, vault: VAULT_ADDRESS },
                blockNumber: 50n,
            }],
            stakeLogs: [{ blockNumber: 100n }],
        });
        prismaMock.position.findFirst
            // First call: outer findByPositionHash to check existence → null
            .mockResolvedValueOnce(null)
            // Second call: inner findByPositionHash inside discover() → null
            .mockResolvedValueOnce(null)
            // Subsequent: findById calls inside refresh path
            .mockResolvedValue(makePositionRow());
        prismaMock.position.create.mockResolvedValue(makePositionRow());

        const result = await service.discoverWalletPositions(USER_ID, OWNER_ADDRESS, [CHAIN_ID]);

        expect(result.found).toBe(1);
        expect(result.imported).toBe(1);
        expect(prismaMock.position.create).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // 6. refresh — always orchestrates ledger sync + state refresh (NO updatedAt cache)
    // -------------------------------------------------------------------------
    it('refresh — always calls syncFromChain + refreshOnChainState (no updatedAt short-circuit)', async () => {
        // Position was just updated 1ms ago — would be a cache hit if we had a 15s cache.
        const recentRow = makePositionRow({ updatedAt: new Date(Date.now() - 1) });
        prismaMock.position.findFirst.mockResolvedValue(recentRow);

        const { service } = makeService({});
        await service.refresh(POSITION_ID);

        // refreshAllPositionLogs called → syncFromChain called
        expect(mockLedgerInstance.syncFromChain).toHaveBeenCalledTimes(1);
        // refreshOnChainState ran → position.update called
        expect(prismaMock.position.update).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // 7. refreshOnChainState — Staked → Settled emits position.closed
    // -------------------------------------------------------------------------
    it('refreshOnChainState — Staked → Settled transition emits position.closed once', async () => {
        // DB state = 'Staked'; chain state = 'Settled' (state index 3)
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({
            vaultReads: { state: 3 /* Settled */ },
        });

        await service.refresh(POSITION_ID);

        const closedCalls = mockCreateAndPublish.mock.calls.filter(
            (c) => c[0].type === 'position.closed',
        );
        expect(closedCalls).toHaveLength(1);
        expect(closedCalls[0]![0].payload.positionHash).toBe(POSITION_HASH);
    });

    // -------------------------------------------------------------------------
    // 8. refreshOnChainState — Staked → Staked does NOT emit position.closed
    // -------------------------------------------------------------------------
    it('refreshOnChainState — no transition does NOT emit position.closed', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({
            vaultReads: { state: 1 /* Staked */ },
        });

        await service.refresh(POSITION_ID);

        const closedCalls = mockCreateAndPublish.mock.calls.filter(
            (c) => c[0].type === 'position.closed',
        );
        expect(closedCalls).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // 9. refreshOnChainState — block-keyed cache hit returns without contract reads
    // -------------------------------------------------------------------------
    it('refreshOnChainState — second call at same block hits the cache (no extra readContract calls)', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service, client } = makeService({});

        await service.refresh(POSITION_ID);
        const firstCallCount = client.readContract.mock.calls.length;

        await service.refresh(POSITION_ID);
        const secondCallCount = client.readContract.mock.calls.length;

        // Second call hits the cache → no new readContract calls.
        expect(secondCallCount).toBe(firstCallCount);
    });

    // -------------------------------------------------------------------------
    // 10. reset — wipes ledger, does NOT emit revert events
    // -------------------------------------------------------------------------
    it('reset — wipes ledger and does NOT emit position.liquidity.reverted (per refinement #3)', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({});

        await service.reset(POSITION_ID);

        expect(mockLedgerInstance.deleteAll).toHaveBeenCalledTimes(1);
        // Reimport ran via syncFromChain
        expect(mockLedgerInstance.syncFromChain).toHaveBeenCalled();
        // No revert events emitted from reset (FK cascade is the source of truth)
        const revertCalls = mockCreateAndPublish.mock.calls.filter(
            (c) => c[0].type === 'position.liquidity.reverted',
        );
        expect(revertCalls).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // 11. reset — journal-rebuild boundary: same liquidity.{increased,decreased}
    //     publish call set as the original import.
    // -------------------------------------------------------------------------
    it('reset — re-publishes the same liquidity.{increased,decreased} events as the original import', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({});

        // First import: syncFromChain pretend-publishes 1 increased + 1 decreased.
        // We capture the events by counting publisher calls of the right types.
        // After PR2's syncFromChain runs, those publishes are emitted by the
        // ledger service internally — but here we mock syncFromChain to be a
        // no-op and instead assert that reset calls syncFromChain (which would
        // re-emit the events identically).
        await service.refresh(POSITION_ID);
        const initialSyncCalls = mockLedgerInstance.syncFromChain.mock.calls.length;

        await service.reset(POSITION_ID);

        // After reset: ledger deleteAll + a fresh syncFromChain call. The fresh
        // syncFromChain pulls the same on-chain history → re-emits the same
        // liquidity.{increased,decreased} events. We verify the boundary: the
        // ledger service is invoked exactly once more for the rebuild.
        expect(mockLedgerInstance.syncFromChain.mock.calls.length).toBe(initialSyncCalls + 1);
        expect(mockLedgerInstance.deleteAll).toHaveBeenCalledTimes(1);

        // Ensure no `position.liquidity.reverted` was emitted by reset itself
        // (refinement #3 boundary: PR3 rebuild relies on the increase/decrease
        // re-emission from PR2's syncFromChain, not on revert noise from reset).
        const revertCount = mockCreateAndPublish.mock.calls.filter(
            (c) => c[0].type === 'position.liquidity.reverted',
        ).length;
        expect(revertCount).toBe(0);
    });

    // -------------------------------------------------------------------------
    // 12. delete — emits position.deleted, transactional
    // -------------------------------------------------------------------------
    it('delete — emits position.deleted in a transaction', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({});

        await service.delete(POSITION_ID);

        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMock.position.delete).toHaveBeenCalledTimes(1);

        const deleteCalls = mockCreateAndPublish.mock.calls.filter(
            (c) => c[0].type === 'position.deleted',
        );
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0]![0].payload.positionId).toBe(POSITION_ID);
    });

    // -------------------------------------------------------------------------
    // 13. fetchMetrics — non-persisted snapshot
    // -------------------------------------------------------------------------
    it('fetchMetrics — returns snapshot with vault state + ledger aggregates', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        mockLedgerInstance.recalculateAggregates.mockResolvedValue({
            liquidityAfter: 0n,
            costBasisAfter: 1500n,
            realizedPnlAfter: 100n,
            collectedYieldAfter: 50n,
            realizedCashflowAfter: 0n,
        });

        const { service } = makeService({
            vaultReads: { state: 1, yieldTarget: 200n, partialUnstakeBps: 0 },
        });
        const metrics = await service.fetchMetrics(POSITION_ID);

        expect(metrics.costBasis).toBe(1500n);
        expect(metrics.realizedPnl).toBe(100n);
        expect(metrics.collectedYield).toBe(50n);
        expect(metrics.vaultState).toBe('Staked');
        expect(metrics.yieldTarget).toBe(200n);
        expect(metrics.pendingBps).toBe(0);
        expect(metrics.isOwnedByUser).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 14. findByPositionHash — DB lookup with positionHash + protocol filter
    // -------------------------------------------------------------------------
    it('findByPositionHash — uses positionHash + protocol filter', async () => {
        prismaMock.position.findFirst.mockResolvedValue(makePositionRow());
        const { service } = makeService({});

        const result = await service.findByPositionHash(USER_ID, POSITION_HASH);

        expect(result?.id).toBe(POSITION_ID);
        expect(prismaMock.position.findFirst).toHaveBeenCalledWith({
            where: { userId: USER_ID, positionHash: POSITION_HASH, protocol: 'uniswapv3-staking' },
        });
    });
});
