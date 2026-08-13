import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV3PositionService } from './uniswapv3-position-service.js';
import type { PrismaClient } from '@midcurve/database';

/**
 * Close-order reconciliation inside position refresh — issue #86.
 *
 * These tests drive `refresh()` far enough to reach the close-order calls and
 * assert what the *caller* observes when reconciliation fails. Everything
 * between the entry point and that block is stubbed: it is RPC-bound and not
 * what is under test here.
 *
 * The behaviour they pin used to be the opposite. A missing registration, an
 * RPC outage and a defect all resolved as success, and the position was
 * returned with an empty close-order list — the positive claim that there are
 * none, rather than the fact that we could not find out.
 */
describe('UniswapV3PositionService — close-order reconciliation failures', () => {
    const POSITION_ID = 'pos-1';

    // Minimal stand-in for the domain object. Only the fields the refresh path
    // reads before reaching the close-order block are populated.
    const makePosition = () =>
        ({
            id: POSITION_ID,
            userId: 'user-1',
            typedConfig: { chainId: 42161, nftId: 123n, poolAddress: '0xpool' },
            typedState: {
                isBurned: false,
                isClosed: false,
                liquidity: 1000n,
                tokensOwed0: 0n,
                tokensOwed1: 0n,
            },
        }) as never;

    let closeOrderService: {
        fetchChainSnapshot: ReturnType<typeof vi.fn>;
        reconcileChainSnapshot: ReturnType<typeof vi.fn>;
        refresh: ReturnType<typeof vi.fn>;
    };
    let service: UniswapV3PositionService;

    /** Stubs every RPC-bound step so the test reaches the close-order block. */
    const stubRefreshPath = (svc: UniswapV3PositionService) => {
        const s = svc as unknown as Record<string, unknown>;
        const spy = (name: string, value: unknown) =>
            vi.spyOn(s as never, name as never).mockResolvedValue(value as never);

        spy('planPositionLogs', { position: makePosition(), logs: [], poolPrices: new Map() });
        spy('fetchPositionState', {
            blockNumber: 100n,
            isBurned: false,
            liquidity: 1000n,
            tokensOwed0: 0n,
            tokensOwed1: 0n,
        });
        spy('importPositionLogs', undefined);
        spy('findById', makePosition());
        spy('refreshOwnerAddress', '0xowner');
        spy('refreshLiquidity', undefined);
        spy('refreshFeeState', undefined);
        spy('refreshPoolState', undefined);
        spy('refreshMetrics', undefined);
        vi.spyOn(s as never, 'buildUserWalletAddresses' as never).mockResolvedValue(
            new Set(['0xowner']) as never,
        );
    };

    beforeEach(() => {
        vi.restoreAllMocks();

        closeOrderService = {
            fetchChainSnapshot: vi.fn(),
            reconcileChainSnapshot: vi.fn(),
            refresh: vi.fn(),
        };

        const prisma = {
            $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
        } as unknown as PrismaClient;

        service = new UniswapV3PositionService({
            prisma,
            eventPublisher: { createAndPublish: vi.fn() } as never,
            closeOrderService: closeOrderService as never,
            // Injected purely to keep the constructor from reaching for
            // singletons that need a live app config.
            evmConfig: { getPublicClient: vi.fn(), isChainSupported: () => true } as never,
            poolService: {} as never,
            quoteTokenService: {} as never,
            evmBlockService: {} as never,
            poolPriceService: {} as never,
            cacheService: {} as never,
            userWalletService: {} as never,
        });

        stubRefreshPath(service);
    });

    // Requirements (1), (3) and (4) of the issue: the failure reaches the
    // caller instead of being reported as a position with no close orders.
    describe('a failed chain read', () => {
        it('propagates an RPC failure rather than resolving', async () => {
            closeOrderService.fetchChainSnapshot.mockRejectedValue(
                new Error('HTTP request failed: 503 Service Unavailable'),
            );

            await expect(service.refresh(POSITION_ID)).rejects.toThrow('503 Service Unavailable');
        });

        it('does not reconcile against a snapshot it failed to read', async () => {
            closeOrderService.fetchChainSnapshot.mockRejectedValue(new Error('boom'));

            await expect(service.refresh(POSITION_ID)).rejects.toThrow();
            expect(closeOrderService.reconcileChainSnapshot).not.toHaveBeenCalled();
        });

        it('never falls back to reading the chain from inside the transaction', async () => {
            closeOrderService.fetchChainSnapshot.mockRejectedValue(new Error('boom'));

            await expect(service.refresh(POSITION_ID)).rejects.toThrow();
            // The old fallback called closeOrderService.refresh() with the
            // transaction client — RPC inside the write transaction, reachable
            // only once the read had already failed.
            expect(closeOrderService.refresh).not.toHaveBeenCalled();
        });
    });

    // Requirement (2), as amended: a checked, logged state — not an exception,
    // and not a branch that silently does less work.
    describe('no closer contract registered for the chain', () => {
        it('completes the refresh instead of failing it', async () => {
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'unavailable',
                reason: 'no-closer-contract',
                chainId: 42161,
                contractName: 'UniswapV3PositionCloser',
            });

            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
        });

        it('skips reconciliation rather than reconciling against nothing', async () => {
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'unavailable',
                reason: 'no-closer-contract',
                chainId: 42161,
                contractName: 'UniswapV3PositionCloser',
            });

            await service.refresh(POSITION_ID);
            expect(closeOrderService.reconcileChainSnapshot).not.toHaveBeenCalled();
        });
    });

    describe('a failed reconciliation', () => {
        // Caveat, so this test is not read as more than it is: a mocked Prisma
        // cannot reproduce PostgreSQL aborting the transaction. Against a real
        // database the statements after a failed write do not run at all —
        // they throw 25P02. That was established separately against PostgreSQL
        // 16.10 / Prisma 6.19.0; see the PR.
        //
        // What this pins is that the caller is told: the error carries its own
        // cause instead of being relabelled by a catch and rediscovered later.
        it('propagates the database error with its cause intact', async () => {
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'ok',
                snapshot: { positionId: POSITION_ID },
            });
            closeOrderService.reconcileChainSnapshot.mockRejectedValue(
                Object.assign(
                    new Error('Unique constraint failed on the fields: (`orderIdentityHash`)'),
                    { code: 'P2002' },
                ),
            );

            await expect(service.refresh(POSITION_ID)).rejects.toThrow('orderIdentityHash');
        });
    });

    describe('the happy path still reconciles', () => {
        it('passes the snapshot it read to reconciliation', async () => {
            const snapshot = { positionId: POSITION_ID, slots: [] };
            closeOrderService.fetchChainSnapshot.mockResolvedValue({ status: 'ok', snapshot });
            closeOrderService.reconcileChainSnapshot.mockResolvedValue({
                orders: [],
                created: 0,
                updated: 0,
                deleted: 0,
            });

            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
            expect(closeOrderService.reconcileChainSnapshot).toHaveBeenCalledWith(
                snapshot,
                expect.anything(),
            );
        });
    });
});
