import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UniswapV3CloseOrderService } from './uniswapv3-close-order-service.js';
import type { PrismaClient } from '@midcurve/database';

/**
 * Issue #86: a missing closer registration is a fact about the database, so it
 * is read and reported rather than thrown and then swallowed. Everything else
 * — an outage, a malformed position — still throws.
 *
 * Issue #86 (c): the automation state transitions are guarded on their source
 * state, so nothing that throws after a successful execution can drag a
 * finished order backwards.
 */
describe('UniswapV3CloseOrderService', () => {
    const POSITION_ID = 'pos-1';
    const ORDER_ID = 'order-1';

    const nftPosition = {
        id: POSITION_ID,
        protocol: 'uniswapv3',
        config: { chainId: 42161, nftId: '123' },
    };

    let prisma: {
        position: { findUnique: ReturnType<typeof vi.fn> };
        systemConfig: { findUnique: ReturnType<typeof vi.fn> };
        closeOrder: {
            update: ReturnType<typeof vi.fn>;
            updateMany: ReturnType<typeof vi.fn>;
            findUnique: ReturnType<typeof vi.fn>;
        };
    };
    let sharedContractService: { findLatestByChainAndName: ReturnType<typeof vi.fn> };
    let service: UniswapV3CloseOrderService;

    /** Spy on the service's own logger.error, silencing the output. */
    const spyOnServiceError = () => {
        const { logger } = service as unknown as {
            logger: { error: (...args: unknown[]) => void };
        };
        return vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    };

    beforeEach(() => {
        prisma = {
            position: { findUnique: vi.fn().mockResolvedValue(nftPosition) },
            systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
            closeOrder: {
                update: vi.fn(),
                updateMany: vi.fn(),
                findUnique: vi.fn(),
            },
        };
        sharedContractService = { findLatestByChainAndName: vi.fn() };

        service = new UniswapV3CloseOrderService({
            prisma: prisma as unknown as PrismaClient,
            sharedContractService: sharedContractService as never,
        });
    });

    describe('fetchChainSnapshot — no closer contract registered', () => {
        beforeEach(() => {
            sharedContractService.findLatestByChainAndName.mockResolvedValue(null);
        });

        it('reports it as a state instead of throwing', async () => {
            const read = await service.fetchChainSnapshot(POSITION_ID);

            expect(read).toEqual({
                status: 'unavailable',
                reason: 'no-closer-contract',
                chainId: 42161,
                contractName: 'UniswapV3PositionCloser',
            });
        });

        it('names the vault closer for a vault position', async () => {
            prisma.position.findUnique.mockResolvedValue({
                id: POSITION_ID,
                protocol: 'uniswapv3-vault',
                config: { chainId: 1, vaultAddress: '0xvault', ownerAddress: '0xowner' },
            });

            const read = await service.fetchChainSnapshot(POSITION_ID);

            expect(read).toMatchObject({
                status: 'unavailable',
                contractName: 'UniswapV3VaultPositionCloser',
            });
        });

        it('returns before doing any chain work', async () => {
            // The point of making this a state: it is knowable from the
            // database, so no RPC is attempted and no exception is constructed.
            await expect(service.fetchChainSnapshot(POSITION_ID)).resolves.toMatchObject({
                status: 'unavailable',
            });
            expect(sharedContractService.findLatestByChainAndName).toHaveBeenCalledTimes(1);
        });
    });

    describe('fetchChainSnapshot — failures that are not states', () => {
        it('throws when the position does not exist', async () => {
            prisma.position.findUnique.mockResolvedValue(null);

            await expect(service.fetchChainSnapshot(POSITION_ID)).rejects.toThrow(
                'Position not found',
            );
        });

        it('throws when a vault position is missing its identifiers', async () => {
            prisma.position.findUnique.mockResolvedValue({
                id: POSITION_ID,
                protocol: 'uniswapv3-vault',
                config: { chainId: 1 },
            });

            await expect(service.fetchChainSnapshot(POSITION_ID)).rejects.toThrow(
                'missing vaultAddress or ownerAddress',
            );
        });
    });

    describe('resolveCloserContract', () => {
        it('returns null when nothing is registered, rather than throwing', async () => {
            sharedContractService.findLatestByChainAndName.mockResolvedValue(null);

            await expect(service.resolveCloserContract(42161, 'uniswapv3')).resolves.toBeNull();
        });

        it('returns the address and the name it looked for', async () => {
            sharedContractService.findLatestByChainAndName.mockResolvedValue({
                config: { address: '0xcloser' },
            });

            await expect(service.resolveCloserContract(42161, 'uniswapv3')).resolves.toEqual({
                contractName: 'UniswapV3PositionCloser',
                address: '0xcloser',
            });
        });
    });

    // #86 (c). The hazard is an order that already executed being dragged
    // backwards by the failure handler — mq.ack throwing after a mined
    // transaction, for instance.
    describe('transitionToRetrying', () => {
        it('transitions an executing order', async () => {
            prisma.closeOrder.updateMany.mockResolvedValue({ count: 1 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'retrying',
            });

            const result = await service.transitionToRetrying(ORDER_ID, 'boom');

            expect(result.automationState).toBe('retrying');
            expect(prisma.closeOrder.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: ORDER_ID, automationState: 'executing' },
                }),
            );
        });

        it('leaves an already-executed order alone', async () => {
            prisma.closeOrder.updateMany.mockResolvedValue({ count: 0 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'executed',
            });

            const result = await service.transitionToRetrying(ORDER_ID, 'boom');

            // Returned unchanged rather than marked for retry and republished.
            expect(result.automationState).toBe('executed');
        });

        it('reports the illegal transition at error with the state it found', async () => {
            // Not a quiet branch. A guard that no-ops silently would just be a
            // sixth swallow, in the state machine that moves money.
            const errorLog = spyOnServiceError();

            prisma.closeOrder.updateMany.mockResolvedValue({ count: 0 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'executed',
            });

            await service.transitionToRetrying(ORDER_ID, 'boom');

            expect(errorLog).toHaveBeenCalledWith(
                { id: ORDER_ID, expected: 'executing', found: 'executed' },
                expect.stringContaining('Illegal transition'),
            );
        });

        it('throws when the order does not exist', async () => {
            prisma.closeOrder.updateMany.mockResolvedValue({ count: 0 });
            prisma.closeOrder.findUnique.mockResolvedValue(null);

            await expect(service.transitionToRetrying(ORDER_ID, 'boom')).rejects.toThrow(
                'Close order not found',
            );
        });
    });

    describe('markFailed', () => {
        it('marks a retrying order failed', async () => {
            prisma.closeOrder.updateMany.mockResolvedValue({ count: 1 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'failed',
            });

            const result = await service.markFailed(ORDER_ID, 'exhausted');

            expect(result.automationState).toBe('failed');
            expect(prisma.closeOrder.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: ORDER_ID, automationState: 'retrying' },
                }),
            );
        });

        it('does not mark an executed order as failed', async () => {
            prisma.closeOrder.updateMany.mockResolvedValue({ count: 0 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'executed',
            });

            const result = await service.markFailed(ORDER_ID, 'exhausted');

            expect(result.automationState).toBe('executed');
        });

        it('reports the illegal transition at error with the state it found', async () => {
            const errorLog = spyOnServiceError();

            prisma.closeOrder.updateMany.mockResolvedValue({ count: 0 });
            prisma.closeOrder.findUnique.mockResolvedValue({
                id: ORDER_ID,
                automationState: 'executed',
            });

            await service.markFailed(ORDER_ID, 'exhausted');

            expect(errorLog).toHaveBeenCalledWith(
                { id: ORDER_ID, expected: 'retrying', found: 'executed' },
                expect.stringContaining('Illegal transition'),
            );
        });
    });
});
