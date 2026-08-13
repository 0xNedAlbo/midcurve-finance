import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV3VaultPositionService } from './uniswapv3-vault-position-service.js';
import type { PrismaClient } from '@midcurve/database';

/**
 * Close-order reconciliation inside vault position refresh — issue #86.
 *
 * The vault path had the harder shape of the defect. A missing closer
 * registration left `closerAddress` undefined with no log line at all, and the
 * closer's event logs were then skipped behind `if (closerAddress)`. The
 * observable signature was nothing whatsoever — and the omission reached the
 * *ledger*, not just the close-order list: OrderExecuted, FeeApplied and
 * SwapExecuted are the closer's events, so an executed close-out went missing
 * from the position's own history.
 */
describe('UniswapV3VaultPositionService — close-order reconciliation failures', () => {
    const POSITION_ID = 'vault-pos-1';

    const makePosition = () =>
        ({
            id: POSITION_ID,
            userId: 'user-1',
            chainId: 42161,
            protocol: 'uniswapv3-vault',
            vaultAddress: '0xvault',
            typedConfig: {
                ownerAddress: '0xowner',
                poolAddress: '0xpool',
                isToken0Quote: true,
                tickLower: -100,
                tickUpper: 100,
                token0Address: '0xt0',
                token1Address: '0xt1',
            },
        }) as never;

    let closeOrderService: {
        resolveCloserContract: ReturnType<typeof vi.fn>;
        fetchChainSnapshot: ReturnType<typeof vi.fn>;
        reconcileChainSnapshot: ReturnType<typeof vi.fn>;
    };
    let service: UniswapV3VaultPositionService;
    let fetchAllVaultLogs: ReturnType<typeof vi.spyOn>;

    const stubRefreshPath = (svc: UniswapV3VaultPositionService) => {
        const s = svc as unknown as Record<string, unknown>;
        const spy = (name: string, value: unknown) =>
            vi.spyOn(s as never, name as never).mockResolvedValue(value as never);

        spy('findById', makePosition());
        fetchAllVaultLogs = spy('fetchAllVaultLogs', []);
        spy('fetchVaultState', { blockNumber: 100n });
        spy('importVaultLogs', undefined);
        spy('writeOnChainState', makePosition());
    };

    beforeEach(() => {
        vi.restoreAllMocks();

        closeOrderService = {
            resolveCloserContract: vi.fn().mockResolvedValue({
                contractName: 'UniswapV3VaultPositionCloser',
                address: '0xcloser',
            }),
            fetchChainSnapshot: vi.fn(),
            reconcileChainSnapshot: vi.fn(),
        };

        const prisma = {
            $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
            // The ledger service reads the last event through raw SQL to work
            // out where to resume the log scan. Empty: nothing imported yet.
            $queryRaw: vi.fn().mockResolvedValue([]),
        } as unknown as PrismaClient;

        service = new UniswapV3VaultPositionService({
            prisma,
            eventPublisher: { createAndPublish: vi.fn() } as never,
            closeOrderService: closeOrderService as never,
            evmConfig: { getPublicClient: vi.fn(), isChainSupported: () => true } as never,
            poolService: {} as never,
            quoteTokenService: {} as never,
            evmBlockService: {} as never,
            poolPriceService: {} as never,
            cacheService: {} as never,
            sharedContractService: {} as never,
            erc20TokenService: {} as never,
        });

        stubRefreshPath(service);
    });

    describe('a failed chain read', () => {
        it('propagates rather than resolving with an empty close-order list', async () => {
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
    });

    describe('no closer contract registered for the chain', () => {
        beforeEach(() => {
            closeOrderService.resolveCloserContract.mockResolvedValue(null);
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'unavailable',
                reason: 'no-closer-contract',
                chainId: 42161,
                contractName: 'UniswapV3VaultPositionCloser',
            });
        });

        it('completes the refresh and skips reconciliation', async () => {
            await expect(service.refresh(POSITION_ID)).resolves.toBeDefined();
            expect(closeOrderService.reconcileChainSnapshot).not.toHaveBeenCalled();
        });

        it('still imports the vault ledger', async () => {
            await service.refresh(POSITION_ID);

            // The ledger is not collateral damage: the vault's own events are
            // fetched whether or not a closer is registered.
            expect(fetchAllVaultLogs).toHaveBeenCalled();
        });

        it('passes no closer address to the log fetch, having said so first', async () => {
            await service.refresh(POSITION_ID);

            // The closer logs genuinely cannot be fetched without an address.
            // What changed is that this is now a stated consequence of a logged
            // fact rather than a silent branch.
            const closerAddressArg = fetchAllVaultLogs.mock.calls[0]?.[5];
            expect(closerAddressArg).toBeUndefined();
        });
    });

    describe('the closer contract is resolved once', () => {
        it('hands the resolved contract to the snapshot read', async () => {
            const closer = {
                contractName: 'UniswapV3VaultPositionCloser',
                address: '0xcloser',
            };
            closeOrderService.resolveCloserContract.mockResolvedValue(closer);
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'ok',
                snapshot: { positionId: POSITION_ID },
            });
            closeOrderService.reconcileChainSnapshot.mockResolvedValue({
                orders: [],
                created: 0,
                updated: 0,
                deleted: 0,
            });

            await service.refresh(POSITION_ID);

            // One lookup, one reaction to it. The two lookups this replaced
            // disagreed about what "not registered" meant: one fell through
            // silently, the other threw.
            expect(closeOrderService.resolveCloserContract).toHaveBeenCalledTimes(1);
            expect(closeOrderService.fetchChainSnapshot).toHaveBeenCalledWith(
                POSITION_ID,
                expect.anything(),
                undefined,
                closer,
            );
        });

        it('uses that address for the closer event logs', async () => {
            closeOrderService.fetchChainSnapshot.mockResolvedValue({
                status: 'ok',
                snapshot: { positionId: POSITION_ID },
            });
            closeOrderService.reconcileChainSnapshot.mockResolvedValue({
                orders: [],
                created: 0,
                updated: 0,
                deleted: 0,
            });

            await service.refresh(POSITION_ID);

            expect(fetchAllVaultLogs.mock.calls[0]?.[5]).toBe('0xcloser');
        });
    });
});
