/**
 * Close Order Service
 *
 * Provides CRUD operations and lifecycle management for close orders.
 * Platform-independent: all protocol-specific data lives in JSON config/state columns.
 *
 * Key concepts:
 * - protocol: discriminator ('uniswapv3', future: 'aave', 'hyperliquid', etc.)
 * - config: immutable identity data (JSON) — chainId, nftId, contractAddress, etc.
 * - state: mutable on-chain state (JSON) — triggerTick, pool, slippage, etc.
 * - orderIdentityHash: unique identifier, e.g. "uniswapv3/{chainId}/{nftId}/{triggerMode}"
 * - automationState: single lifecycle field (monitoring|executing|retrying|failed|executed)
 * - executionAttempts: retry counter, resets when price moves away from trigger
 *
 * DB lifecycle driven by on-chain events:
 * - OrderRegistered → INSERT (automationState=monitoring)
 * - OrderCancelled → DELETE
 * - OrderExecuted → UPDATE automationState=executed
 * - Re-registration at same slot → DELETE old, INSERT new
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { CloseOrder, Prisma } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type {
  CreateCloseOrderInput,
  SyncFromChainInput,
  FindCloseOrderOptions,
} from '../types/automation/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for CloseOrderService
 */
export interface CloseOrderServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * CloseOrder with position and pool relations included.
 * Used by price monitor for subscription sync.
 */
export interface CloseOrderWithPosition extends CloseOrder {
  position: {
    id: string;
    pool: {
      id: string;
      config: Prisma.JsonValue;
    } | null;
  };
}

// ============================================================================
// Service
// ============================================================================

export class CloseOrderService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: CloseOrderServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('CloseOrderService');
  }

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  /**
   * Creates a new close order record.
   * Called when an OrderRegistered event is received from the chain.
   */
  async create(
    input: CreateCloseOrderInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'create', {
      positionId: input.positionId,
      protocol: input.protocol,
      orderIdentityHash: input.orderIdentityHash,
    });

    try {
      const db = tx ?? this.prisma;

      const result = await db.closeOrder.create({
        data: {
          protocol: input.protocol,
          positionId: input.positionId,
          sharedContractId: input.sharedContractId,
          orderIdentityHash: input.orderIdentityHash,
          closeOrderHash: input.closeOrderHash,
          automationState: input.automationState ?? 'monitoring',
          config: input.config as Prisma.InputJsonValue,
          state: input.state as Prisma.InputJsonValue,
        },
      });

      this.logger.info(
        { id: result.id, positionId: result.positionId, protocol: result.protocol },
        'Close order created',
      );
      log.methodExit(this.logger, 'create', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds an order by ID.
   */
  async findById(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({ where: { id } });
  }

  /**
   * Finds an order by its unique identity hash.
   * E.g. "uniswapv3/1/12345/0" for UniswapV3 orders.
   */
  async findByOrderIdentityHash(
    orderIdentityHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({
      where: { orderIdentityHash },
    });
  }

  /**
   * Finds an order by position ID and close order hash.
   * URL-friendly lookup for API endpoints.
   * Uses @@unique([positionId, closeOrderHash]).
   */
  async findByPositionAndHash(
    positionId: string,
    closeOrderHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findUnique({
      where: {
        positionId_closeOrderHash: { positionId, closeOrderHash },
      },
    });
  }

  /**
   * Finds close orders by position ID with optional filters.
   */
  async findByPositionId(
    positionId: string,
    options: FindCloseOrderOptions = {},
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    const where = this.buildWhereClause({ ...options, positionId });

    return db.closeOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Finds all orders that are actively being monitored.
   * automationState=monitoring.
   * Includes position→pool relations for subscription sync.
   */
  async findMonitoringOrders(
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderWithPosition[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: {
        automationState: 'monitoring',
      },
      include: {
        position: {
          select: {
            id: true,
            pool: { select: { id: true, config: true } },
          },
        },
      },
    }) as Promise<CloseOrderWithPosition[]>;
  }

  /**
   * Gets distinct pools with actively monitoring orders.
   * Used for pool price subscription sync.
   */
  async getPoolsWithMonitoringOrders(
    tx?: PrismaTransactionClient,
  ): Promise<Array<{ chainId: number; poolAddress: string; poolId: string }>> {
    log.methodEntry(this.logger, 'getPoolsWithMonitoringOrders', {});

    try {
      const db = tx ?? this.prisma;
      const orders = await db.closeOrder.findMany({
        where: {
          automationState: 'monitoring',
        },
        select: {
          position: {
            select: {
              pool: { select: { id: true, config: true } },
            },
          },
        },
      });

      const poolsMap = new Map<
        string,
        { chainId: number; poolAddress: string; poolId: string }
      >();

      for (const order of orders) {
        const pool = order.position?.pool;
        if (!pool) continue;

        const poolConfig = pool.config as Record<string, unknown> | null;
        if (!poolConfig) continue;

        const chainId = poolConfig.chainId as number | undefined;
        const poolAddress = poolConfig.address as string | undefined;
        if (chainId && poolAddress) {
          const key = `${chainId}-${poolAddress.toLowerCase()}`;
          poolsMap.set(key, {
            chainId,
            poolAddress,
            poolId: pool.id,
          });
        }
      }

      const pools = Array.from(poolsMap.values());
      log.methodExit(this.logger, 'getPoolsWithMonitoringOrders', {
        count: pools.length,
      });
      return pools;
    } catch (error) {
      log.methodError(
        this.logger,
        'getPoolsWithMonitoringOrders',
        error as Error,
        {},
      );
      throw error;
    }
  }

  /**
   * Finds actively monitoring orders for a specific pool.
   */
  async findMonitoringOrdersForPool(
    poolId: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: {
        position: {
          pool: { id: poolId },
        },
        automationState: 'monitoring',
      },
    });
  }

  /**
   * Finds orders in retrying state (for startup recovery).
   */
  async findRetryingOrders(
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: { automationState: 'retrying' },
    });
  }

  /**
   * Deletes an order. Used when OrderCancelled event is received,
   * or when a new registration overwrites an existing slot.
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      const db = tx ?? this.prisma;
      await db.closeOrder.delete({ where: { id } });

      this.logger.info({ id }, 'Close order deleted');
      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // STATE UPDATES
  // ==========================================================================

  /**
   * Merges partial updates into the order's state JSON (read-modify-write).
   * Used for on-chain config-change events (operator, payout, validUntil, slippage).
   */
  async mergeState(
    id: string,
    stateUpdates: Record<string, unknown>,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'mergeState', {
      id,
      updateKeys: Object.keys(stateUpdates),
    });

    try {
      const db = tx ?? this.prisma;
      const existing = await db.closeOrder.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      const currentState = (existing.state as Record<string, unknown>) ?? {};
      const mergedState = { ...currentState, ...stateUpdates };

      const result = await db.closeOrder.update({
        where: { id },
        data: { state: mergedState as Prisma.InputJsonValue },
      });

      this.logger.info(
        { id, updatedFields: Object.keys(stateUpdates) },
        'Close order state merged',
      );
      log.methodExit(this.logger, 'mergeState', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'mergeState', error as Error, { id });
      throw error;
    }
  }

  /**
   * Updates the closeOrderHash column (e.g. when trigger tick changes).
   * Also merges state updates if provided.
   */
  async updateCloseOrderHash(
    id: string,
    newCloseOrderHash: string,
    stateUpdates?: Record<string, unknown>,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'updateCloseOrderHash', {
      id,
      newCloseOrderHash,
    });

    try {
      const db = tx ?? this.prisma;

      if (stateUpdates) {
        const existing = await db.closeOrder.findUnique({ where: { id } });
        if (!existing) {
          throw new Error(`Close order not found: ${id}`);
        }

        const currentState = (existing.state as Record<string, unknown>) ?? {};
        const mergedState = { ...currentState, ...stateUpdates };

        const result = await db.closeOrder.update({
          where: { id },
          data: {
            closeOrderHash: newCloseOrderHash,
            state: mergedState as Prisma.InputJsonValue,
          },
        });

        this.logger.info({ id, newCloseOrderHash }, 'Close order hash and state updated');
        log.methodExit(this.logger, 'updateCloseOrderHash', { id });
        return result;
      }

      const result = await db.closeOrder.update({
        where: { id },
        data: { closeOrderHash: newCloseOrderHash },
      });

      this.logger.info({ id, newCloseOrderHash }, 'Close order hash updated');
      log.methodExit(this.logger, 'updateCloseOrderHash', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateCloseOrderHash', error as Error, {
        id,
        newCloseOrderHash,
      });
      throw error;
    }
  }

  /**
   * Refreshes on-chain state from a getOrder() call.
   * Updates state JSON and lastSyncedAt.
   */
  async syncFromChain(
    id: string,
    chainData: SyncFromChainInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'syncFromChain', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          state: chainData.state as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });

      this.logger.info({ id }, 'Order synced from chain');
      log.methodExit(this.logger, 'syncFromChain', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'syncFromChain', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // AUTOMATION STATE TRANSITIONS
  // ==========================================================================

  /**
   * Atomic conditional transition: monitoring|retrying → executing.
   *
   * Concurrency gate: uses updateMany with WHERE automationState IN ('monitoring','retrying')
   * to ensure only one consumer wins the race. Increments executionAttempts.
   * Throws if lost the race.
   */
  async atomicTransitionToExecuting(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'atomicTransitionToExecuting', { id });

    try {
      const db = tx ?? this.prisma;

      // CAS: only transition if in monitoring or retrying
      const updateResult = await db.closeOrder.updateMany({
        where: {
          id,
          automationState: { in: ['monitoring', 'retrying'] },
        },
        data: {
          automationState: 'executing',
        },
      });

      if (updateResult.count === 0) {
        const current = await db.closeOrder.findUnique({
          where: { id },
          select: { automationState: true },
        });
        throw new Error(
          `Failed to transition order ${id} to executing: ` +
            `current automationState='${current?.automationState}' (expected 'monitoring' or 'retrying'). ` +
            `Race condition detected.`,
        );
      }

      // Increment executionAttempts in follow-up update
      const result = await db.closeOrder.update({
        where: { id },
        data: { executionAttempts: { increment: 1 } },
      });

      this.logger.info(
        { id, executionAttempts: result.executionAttempts },
        'Order transitioned to executing',
      );
      log.methodExit(this.logger, 'atomicTransitionToExecuting', { id });
      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'atomicTransitionToExecuting',
        error as Error,
        { id },
      );
      throw error;
    }
  }

  /**
   * Transitions executing → retrying (execution failed, waiting for retry).
   * Sets lastError for diagnostics.
   */
  async transitionToRetrying(
    id: string,
    error: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'transitionToRetrying', { id, error });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'retrying',
          lastError: error,
        },
      });

      this.logger.info({ id, automationState: 'retrying' }, 'Order transitioned to retrying');
      log.methodExit(this.logger, 'transitionToRetrying', { id });
      return result;
    } catch (err) {
      log.methodError(this.logger, 'transitionToRetrying', err as Error, { id });
      throw err;
    }
  }

  /**
   * Resets retrying → monitoring (price moved away from trigger).
   * Clears executionAttempts and lastError.
   */
  async resetToMonitoring(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'resetToMonitoring', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'monitoring',
          executionAttempts: 0,
          lastError: null,
        },
      });

      this.logger.info({ id }, 'Order reset to monitoring (price moved away)');
      log.methodExit(this.logger, 'resetToMonitoring', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'resetToMonitoring', error as Error, { id });
      throw error;
    }
  }

  /**
   * Marks order as failed (max execution attempts exhausted, terminal).
   * User must cancel on-chain and re-register to try again.
   */
  async markFailed(
    id: string,
    error: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'markFailed', { id, error });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          automationState: 'failed',
          lastError: error,
        },
      });

      this.logger.warn({ id, automationState: 'failed' }, 'Order marked as failed');
      log.methodExit(this.logger, 'markFailed', { id });
      return result;
    } catch (err) {
      log.methodError(this.logger, 'markFailed', err as Error, { id });
      throw err;
    }
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private buildWhereClause(
    options: FindCloseOrderOptions & { positionId?: string },
  ): Prisma.CloseOrderWhereInput {
    const where: Prisma.CloseOrderWhereInput = {};

    if (options.positionId) {
      where.positionId = options.positionId;
    }

    if (options.automationState !== undefined) {
      if (Array.isArray(options.automationState)) {
        where.automationState = { in: options.automationState };
      } else {
        where.automationState = options.automationState;
      }
    }

    return where;
  }
}
