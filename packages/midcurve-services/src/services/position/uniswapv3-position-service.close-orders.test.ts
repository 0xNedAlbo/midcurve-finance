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

    describe('CHARACTERIZATION — current behaviour, before the fix', () => {
        it('swallows an RPC failure in the chain read and resolves as if nothing happened', async () => {
            closeOrderService.fetchChainSnapshot.mockRejectedValue(
                new Error('HTTP request failed: 503 Service Unavailable'),
            );

            // The defect: a failed read resolves, and the caller cannot tell.
            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
            expect(closeOrderService.reconcileChainSnapshot).not.toHaveBeenCalled();
        });

        it('swallows a missing closer registration, which reaches it as a thrown error', async () => {
            closeOrderService.fetchChainSnapshot.mockRejectedValue(
                new Error('No UniswapV3PositionCloser contract found for chain 42161'),
            );

            // A knowable fact — the contract row is absent — arrives as an
            // exception and is then discarded. Same observable as an outage.
            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
        });

        // Caveat, so this test is not read as more than it is: a mocked Prisma
        // cannot reproduce PostgreSQL aborting the transaction. Against a real
        // database the `findById` below this catch does not return — it throws
        // 25P02, and the caller gets a raw ConnectorError instead of the
        // "non-fatal" story the log tells. That was established separately
        // against PostgreSQL 16.10 / Prisma 6.19.0; see the PR.
        //
        // What this test does pin is the control flow: the catch exists, it
        // discards the cause, and the method goes on to return normally.
        it('swallows a reconciliation failure raised inside the write transaction', async () => {
            closeOrderService.fetchChainSnapshot.mockResolvedValue({ positionId: POSITION_ID });
            closeOrderService.reconcileChainSnapshot.mockRejectedValue(
                Object.assign(new Error('Unique constraint failed on the fields: (`orderIdentityHash`)'), {
                    code: 'P2002',
                }),
            );

            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
        });
    });
});
