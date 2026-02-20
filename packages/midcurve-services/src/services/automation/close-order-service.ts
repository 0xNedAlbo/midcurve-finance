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
 * - onChainStatus: mirrors contract OrderStatus enum (NONE/ACTIVE/EXECUTED/CANCELLED)
 * - monitoringState: off-chain state managed by price monitor (idle/monitoring/triggered/suspended)
 * - closeOrderHash: URL-friendly identifier "sl@{tick}" or "tp@{tick}"
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { CloseOrder, Prisma } from '@midcurve/database';
import { OnChainOrderStatus, type MonitoringState } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type {
  CreateCloseOrderInput,
  UpsertFromOnChainEventInput,
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
   * Used by the API registration flow when a user registers via UI.
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
          onChainStatus: input.onChainStatus ?? OnChainOrderStatus.NONE,
          monitoringState: input.monitoringState ?? 'idle',
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
   * Upserts an order from an on-chain event (OrderRegistered).
   * Used by ProcessCloseOrderEventsRule when indexing contract events.
   * Upserts on orderIdentityHash unique constraint.
   */
  async upsertFromOnChainEvent(
    input: UpsertFromOnChainEventInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'upsertFromOnChainEvent', {
      positionId: input.positionId,
      protocol: input.protocol,
      orderIdentityHash: input.orderIdentityHash,
    });

    try {
      const db = tx ?? this.prisma;

      const sharedData = {
        positionId: input.positionId,
        sharedContractId: input.sharedContractId,
        onChainStatus: input.onChainStatus,
        closeOrderHash: input.closeOrderHash,
        lastSyncedAt: new Date(),
        monitoringState: input.monitoringState ?? ('monitoring' as MonitoringState),
        config: input.config as Prisma.InputJsonValue,
        state: input.state as Prisma.InputJsonValue,
      };

      const result = await db.closeOrder.upsert({
        where: {
          orderIdentityHash: input.orderIdentityHash,
        },
        create: {
          protocol: input.protocol,
          orderIdentityHash: input.orderIdentityHash,
          ...sharedData,
        },
        update: sharedData,
      });

      this.logger.info(
        {
          id: result.id,
          positionId: input.positionId,
          protocol: input.protocol,
          orderIdentityHash: input.orderIdentityHash,
          closeOrderHash: input.closeOrderHash,
        },
        'Close order upserted from event',
      );
      log.methodExit(this.logger, 'upsertFromOnChainEvent', { id: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'upsertFromOnChainEvent', error as Error, {
        input,
      });
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
   * onChainStatus=ACTIVE AND monitoringState=monitoring.
   * Includes position→pool relations for subscription sync.
   */
  async findMonitoringOrders(
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderWithPosition[]> {
    const db = tx ?? this.prisma;
    return db.closeOrder.findMany({
      where: {
        onChainStatus: OnChainOrderStatus.ACTIVE,
        monitoringState: 'monitoring',
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
   * Extracts chainId/poolAddress from position→pool config (platform-independent).
   */
  async getPoolsWithMonitoringOrders(
    tx?: PrismaTransactionClient,
  ): Promise<Array<{ chainId: number; poolAddress: string; poolId: string }>> {
    log.methodEntry(this.logger, 'getPoolsWithMonitoringOrders', {});

    try {
      const db = tx ?? this.prisma;
      const orders = await db.closeOrder.findMany({
        where: {
          onChainStatus: OnChainOrderStatus.ACTIVE,
          monitoringState: 'monitoring',
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
   * Filters via position→pool relation since pool address is now in JSON config.
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
        onChainStatus: OnChainOrderStatus.ACTIVE,
        monitoringState: 'monitoring',
      },
    });
  }

  /**
   * Deletes an order. Only allowed for terminal on-chain states with idle monitoring.
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      const db = tx ?? this.prisma;
      const existing = await db.closeOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      const terminalStatuses = [
        OnChainOrderStatus.NONE,
        OnChainOrderStatus.EXECUTED,
        OnChainOrderStatus.CANCELLED,
      ];
      if (!terminalStatuses.includes(existing.onChainStatus as 0 | 2 | 3)) {
        throw new Error(
          `Cannot delete order with onChainStatus=${existing.onChainStatus}. Must be NONE, EXECUTED, or CANCELLED.`,
        );
      }

      if (existing.monitoringState !== 'idle') {
        throw new Error(
          `Cannot delete order with monitoringState=${existing.monitoringState}. Must be idle.`,
        );
      }

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
   * Refreshes all on-chain state from a getOrder() call.
   * Replaces the full state JSON and updates onChainStatus + lastSyncedAt.
   */
  async syncFromChain(
    id: string,
    chainData: SyncFromChainInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'syncFromChain', {
      id,
      onChainStatus: chainData.onChainStatus,
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          onChainStatus: chainData.onChainStatus,
          state: chainData.state as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      });

      this.logger.info(
        { id, onChainStatus: chainData.onChainStatus },
        'Order synced from chain',
      );
      log.methodExit(this.logger, 'syncFromChain', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'syncFromChain', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // ON-CHAIN STATUS LIFECYCLE
  // ==========================================================================

  /**
   * Marks order as ACTIVE on-chain. Merges registration metadata into state
   * and starts monitoring.
   */
  async markOnChainActive(
    id: string,
    input: { registrationTxHash: string; registeredAt?: Date },
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'markOnChainActive', { id });

    try {
      const db = tx ?? this.prisma;

      const existing = await db.closeOrder.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      const currentState = (existing.state as Record<string, unknown>) ?? {};
      const mergedState = {
        ...currentState,
        registrationTxHash: input.registrationTxHash,
        registeredAt: (input.registeredAt ?? new Date()).toISOString(),
      };

      const result = await db.closeOrder.update({
        where: { id },
        data: {
          onChainStatus: OnChainOrderStatus.ACTIVE,
          monitoringState: 'monitoring',
          state: mergedState as Prisma.InputJsonValue,
        },
      });

      this.logger.info({ id }, 'Order marked on-chain ACTIVE');
      log.methodExit(this.logger, 'markOnChainActive', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markOnChainActive', error as Error, {
        id,
      });
      throw error;
    }
  }

  /**
   * Marks order as EXECUTED on-chain. Sets monitoringState to idle.
   */
  async markOnChainExecuted(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'markOnChainExecuted', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          onChainStatus: OnChainOrderStatus.EXECUTED,
          monitoringState: 'idle',
        },
      });

      this.logger.info({ id }, 'Order marked on-chain EXECUTED');
      log.methodExit(this.logger, 'markOnChainExecuted', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markOnChainExecuted', error as Error, {
        id,
      });
      throw error;
    }
  }

  /**
   * Marks order as CANCELLED on-chain. Sets monitoringState to idle.
   */
  async markOnChainCancelled(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'markOnChainCancelled', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          onChainStatus: OnChainOrderStatus.CANCELLED,
          monitoringState: 'idle',
        },
      });

      this.logger.info({ id }, 'Order marked on-chain CANCELLED');
      log.methodExit(this.logger, 'markOnChainCancelled', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markOnChainCancelled', error as Error, {
        id,
      });
      throw error;
    }
  }

  // ==========================================================================
  // MONITORING STATE TRANSITIONS
  // ==========================================================================

  /**
   * Atomic conditional transition: monitoring → triggered.
   *
   * Concurrency gate: uses updateMany with WHERE monitoringState='monitoring'
   * to ensure only one trigger consumer wins the race. Throws if lost the race.
   */
  async atomicTransitionToTriggered(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'atomicTransitionToTriggered', { id });

    try {
      const db = tx ?? this.prisma;

      const updateResult = await db.closeOrder.updateMany({
        where: {
          id,
          monitoringState: 'monitoring',
        },
        data: {
          monitoringState: 'triggered',
        },
      });

      if (updateResult.count === 0) {
        const current = await db.closeOrder.findUnique({
          where: { id },
          select: { monitoringState: true },
        });
        throw new Error(
          `Failed to transition order ${id} to triggered: ` +
            `current monitoringState='${current?.monitoringState}' (expected 'monitoring'). ` +
            `Race condition detected.`,
        );
      }

      const result = await db.closeOrder.findUnique({ where: { id } });
      if (!result) {
        throw new Error(`Order ${id} not found after transition`);
      }

      this.logger.info({ id }, 'Order transitioned to triggered');
      log.methodExit(this.logger, 'atomicTransitionToTriggered', { id });
      return result;
    } catch (error) {
      log.methodError(
        this.logger,
        'atomicTransitionToTriggered',
        error as Error,
        { id },
      );
      throw error;
    }
  }

  /**
   * Transitions triggered → monitoring (execution failed, retry scheduled).
   */
  async transitionToMonitoring(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    return this.updateMonitoringState(id, 'monitoring', tx);
  }

  /**
   * Transitions to suspended state with an optional reason.
   *
   * When a reason is provided, it is stored as `suspendedReason` in the
   * order's state JSON so the API serializer can distinguish between
   * execution failures and position-closure suspensions.
   *
   * @param id - Close order ID
   * @param reason - Why the order was suspended:
   *   - 'execution_failed': max execution retries exhausted (genuine failure)
   *   - 'position_closed': position was closed by another order (superseded)
   * @param tx - Optional Prisma transaction client
   */
  async transitionToSuspended(
    id: string,
    reason?: 'execution_failed' | 'position_closed',
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    if (reason) {
      log.methodEntry(this.logger, 'transitionToSuspended', { id, reason });
      const db = tx ?? this.prisma;
      const existing = await db.closeOrder.findUniqueOrThrow({ where: { id } });
      const currentState = (existing.state as Record<string, unknown>) ?? {};
      const result = await db.closeOrder.update({
        where: { id },
        data: {
          monitoringState: 'suspended',
          state: { ...currentState, suspendedReason: reason } as Prisma.InputJsonValue,
        },
      });
      this.logger.info({ id, monitoringState: 'suspended', reason }, 'Monitoring state updated with reason');
      log.methodExit(this.logger, 'transitionToSuspended', { id });
      return result;
    }
    return this.updateMonitoringState(id, 'suspended', tx);
  }

  /**
   * Transitions any → idle (terminal on-chain state reached).
   */
  async transitionToIdle(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    return this.updateMonitoringState(id, 'idle', tx);
  }

  /**
   * Transitions idle → monitoring (order became ACTIVE on-chain).
   */
  async startMonitoring(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    return this.updateMonitoringState(id, 'monitoring', tx);
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async updateMonitoringState(
    id: string,
    newState: MonitoringState,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrder> {
    log.methodEntry(this.logger, 'updateMonitoringState', { id, newState });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrder.update({
        where: { id },
        data: { monitoringState: newState },
      });

      this.logger.info({ id, monitoringState: newState }, 'Monitoring state updated');
      log.methodExit(this.logger, 'updateMonitoringState', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateMonitoringState', error as Error, {
        id,
        newState,
      });
      throw error;
    }
  }

  private buildWhereClause(
    options: FindCloseOrderOptions & { positionId?: string },
  ): Prisma.CloseOrderWhereInput {
    const where: Prisma.CloseOrderWhereInput = {};

    if (options.positionId) {
      where.positionId = options.positionId;
    }

    if (options.onChainStatus !== undefined) {
      if (Array.isArray(options.onChainStatus)) {
        where.onChainStatus = { in: options.onChainStatus };
      } else {
        where.onChainStatus = options.onChainStatus;
      }
    }

    if (options.monitoringState !== undefined) {
      if (Array.isArray(options.monitoringState)) {
        where.monitoringState = { in: options.monitoringState };
      } else {
        where.monitoringState = options.monitoringState;
      }
    }

    return where;
  }
}
