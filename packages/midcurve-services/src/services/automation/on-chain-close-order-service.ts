/**
 * On-Chain Close Order Service
 *
 * Provides CRUD operations and lifecycle management for on-chain close orders.
 * Replaces the old CloseOrderService that used JSON blobs (config/state columns).
 *
 * Operates on `prisma.onChainCloseOrder` with explicit columns that mirror
 * the smart contract's CloseOrder struct. Returns Prisma-generated types directly
 * — no domain class hierarchy, no factory pattern.
 *
 * Key concepts:
 * - onChainStatus: mirrors contract OrderStatus enum (NONE/ACTIVE/EXECUTED/CANCELLED)
 * - monitoringState: off-chain state managed by our price monitor (idle/monitoring/triggered/suspended)
 * - closeOrderHash: URL-friendly identifier "sl@{tick}" or "tp@{tick}"
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { OnChainCloseOrder, Prisma } from '@midcurve/database';
import { OnChainOrderStatus, type MonitoringState } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type {
  CreateOnChainCloseOrderInput,
  UpsertFromOnChainEventInput,
  SyncFromChainInput,
  FindOnChainCloseOrderOptions,
} from '../types/automation/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for OnChainCloseOrderService
 */
export interface OnChainCloseOrderServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * OnChainCloseOrder with position and pool relations included.
 * Used by price monitor for subscription sync.
 */
export interface OnChainCloseOrderWithPosition extends OnChainCloseOrder {
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

export class OnChainCloseOrderService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: OnChainCloseOrderServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('OnChainCloseOrderService');
  }

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  /**
   * Creates a new on-chain close order record.
   * Used by the API registration flow when a user registers via UI.
   */
  async create(
    input: CreateOnChainCloseOrderInput,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'create', {
      positionId: input.positionId,
      chainId: input.chainId,
      nftId: input.nftId,
      triggerMode: input.triggerMode,
    });

    try {
      const db = tx ?? this.prisma;

      const result = await db.onChainCloseOrder.create({
        data: {
          positionId: input.positionId,
          chainId: input.chainId,
          nftId: input.nftId,
          triggerMode: input.triggerMode,
          contractAddress: input.contractAddress,
          sharedContractId: input.sharedContractId,
          onChainStatus: input.onChainStatus ?? OnChainOrderStatus.NONE,
          triggerTick: input.triggerTick,
          slippageBps: input.slippageBps,
          payoutAddress: input.payoutAddress,
          operatorAddress: input.operatorAddress,
          owner: input.owner,
          pool: input.pool,
          validUntil: input.validUntil,
          swapDirection: input.swapDirection ?? 0,
          swapSlippageBps: input.swapSlippageBps ?? 0,
          registrationTxHash: input.registrationTxHash,
          registeredAt: input.registeredAt,
          closeOrderHash: input.closeOrderHash,
          monitoringState: input.monitoringState ?? 'idle',
        },
      });

      this.logger.info(
        { id: result.id, positionId: result.positionId },
        'On-chain close order created',
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
   * Upserts on (chainId, nftId, triggerMode) unique constraint.
   */
  async upsertFromOnChainEvent(
    input: UpsertFromOnChainEventInput,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'upsertFromOnChainEvent', {
      positionId: input.positionId,
      chainId: input.chainId,
      nftId: input.nftId,
      triggerMode: input.triggerMode,
    });

    try {
      const db = tx ?? this.prisma;

      const data = {
        positionId: input.positionId,
        contractAddress: input.contractAddress,
        sharedContractId: input.sharedContractId,
        onChainStatus: input.onChainStatus,
        triggerTick: input.triggerTick,
        slippageBps: input.slippageBps,
        payoutAddress: input.payoutAddress,
        operatorAddress: input.operatorAddress,
        owner: input.owner,
        pool: input.pool,
        validUntil: input.validUntil,
        swapDirection: input.swapDirection,
        swapSlippageBps: input.swapSlippageBps,
        registrationTxHash: input.registrationTxHash,
        registeredAt: new Date(),
        closeOrderHash: input.closeOrderHash,
        lastSyncBlock: input.blockNumber,
        lastSyncedAt: new Date(),
        monitoringState: 'monitoring' as MonitoringState,
      };

      const result = await db.onChainCloseOrder.upsert({
        where: {
          chainId_nftId_triggerMode: {
            chainId: input.chainId,
            nftId: input.nftId,
            triggerMode: input.triggerMode,
          },
        },
        create: {
          chainId: input.chainId,
          nftId: input.nftId,
          triggerMode: input.triggerMode,
          ...data,
        },
        update: data,
      });

      this.logger.info(
        {
          id: result.id,
          positionId: input.positionId,
          nftId: input.nftId,
          triggerMode: input.triggerMode,
          closeOrderHash: input.closeOrderHash,
        },
        'On-chain close order upserted from event',
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
  ): Promise<OnChainCloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.onChainCloseOrder.findUnique({ where: { id } });
  }

  /**
   * Finds an order by its on-chain identity (chainId, nftId, triggerMode).
   * Direct unique index lookup — replaces the old JSON path filtering.
   */
  async findByOnChainIdentity(
    chainId: number,
    nftId: string,
    triggerMode: number,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.onChainCloseOrder.findUnique({
      where: {
        chainId_nftId_triggerMode: { chainId, nftId, triggerMode },
      },
    });
  }

  /**
   * Finds an order by position ID and trigger mode.
   * Uses @@unique([positionId, triggerMode]).
   */
  async findByPositionAndTriggerMode(
    positionId: string,
    triggerMode: number,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder | null> {
    const db = tx ?? this.prisma;
    return db.onChainCloseOrder.findUnique({
      where: {
        positionId_triggerMode: { positionId, triggerMode },
      },
    });
  }

  /**
   * Finds an order by position ID and close order hash.
   * URL-friendly lookup for API endpoints.
   */
  async findByPositionAndHash(
    positionId: string,
    closeOrderHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder | null> {
    const db = tx ?? this.prisma;
    const results = await db.onChainCloseOrder.findMany({
      where: { positionId, closeOrderHash },
      take: 1,
    });
    return results[0] ?? null;
  }

  /**
   * Finds close orders by position ID with optional filters.
   */
  async findByPositionId(
    positionId: string,
    options: FindOnChainCloseOrderOptions = {},
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder[]> {
    const db = tx ?? this.prisma;
    const where = this.buildWhereClause({ ...options, positionId });

    return db.onChainCloseOrder.findMany({
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
  ): Promise<OnChainCloseOrderWithPosition[]> {
    const db = tx ?? this.prisma;
    return db.onChainCloseOrder.findMany({
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
    }) as Promise<OnChainCloseOrderWithPosition[]>;
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
      const orders = await db.onChainCloseOrder.findMany({
        where: {
          onChainStatus: OnChainOrderStatus.ACTIVE,
          monitoringState: 'monitoring',
          pool: { not: null },
        },
        select: {
          chainId: true,
          pool: true,
          position: {
            select: {
              pool: { select: { id: true } },
            },
          },
        },
      });

      const poolsMap = new Map<
        string,
        { chainId: number; poolAddress: string; poolId: string }
      >();

      for (const order of orders) {
        const poolAddress = order.pool;
        const poolId = order.position?.pool?.id;
        if (poolAddress && poolId) {
          const key = `${order.chainId}-${poolAddress.toLowerCase()}`;
          poolsMap.set(key, {
            chainId: order.chainId,
            poolAddress,
            poolId,
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
   * Uses @@index([pool]) directly.
   */
  async findMonitoringOrdersForPool(
    poolAddress: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder[]> {
    const db = tx ?? this.prisma;
    return db.onChainCloseOrder.findMany({
      where: {
        pool: poolAddress,
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
      const existing = await db.onChainCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`On-chain close order not found: ${id}`);
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

      await db.onChainCloseOrder.delete({ where: { id } });

      this.logger.info({ id }, 'On-chain close order deleted');
      log.methodExit(this.logger, 'delete', { id });
    } catch (error) {
      log.methodError(this.logger, 'delete', error as Error, { id });
      throw error;
    }
  }

  // ==========================================================================
  // ON-CHAIN STATE UPDATES (from ProcessCloseOrderEventsRule)
  // ==========================================================================

  /**
   * Updates on-chain fields from contract config-change events.
   * Generic field update for operator, payout, validUntil, slippage changes.
   */
  async updateOnChainFields(
    id: string,
    data: Prisma.OnChainCloseOrderUpdateInput,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'updateOnChainFields', {
      id,
      updateKeys: Object.keys(data),
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
        where: { id },
        data,
      });

      this.logger.info(
        { id, updatedFields: Object.keys(data) },
        'On-chain close order fields updated',
      );
      log.methodExit(this.logger, 'updateOnChainFields', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateOnChainFields', error as Error, {
        id,
      });
      throw error;
    }
  }

  /**
   * Updates trigger tick and recalculates closeOrderHash.
   */
  async updateTriggerTick(
    id: string,
    newTriggerTick: number,
    newCloseOrderHash: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'updateTriggerTick', {
      id,
      newTriggerTick,
      newCloseOrderHash,
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
        where: { id },
        data: {
          triggerTick: newTriggerTick,
          closeOrderHash: newCloseOrderHash,
        },
      });

      this.logger.info(
        { id, newTriggerTick, newCloseOrderHash },
        'Trigger tick updated',
      );
      log.methodExit(this.logger, 'updateTriggerTick', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateTriggerTick', error as Error, {
        id,
        newTriggerTick,
      });
      throw error;
    }
  }

  /**
   * Updates swap configuration from on-chain SwapIntentUpdated event.
   */
  async updateSwapConfig(
    id: string,
    swapDirection: number,
    swapSlippageBps: number,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'updateSwapConfig', {
      id,
      swapDirection,
      swapSlippageBps,
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
        where: { id },
        data: { swapDirection, swapSlippageBps },
      });

      this.logger.info(
        { id, swapDirection, swapSlippageBps },
        'Swap config updated',
      );
      log.methodExit(this.logger, 'updateSwapConfig', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'updateSwapConfig', error as Error, {
        id,
        swapDirection,
      });
      throw error;
    }
  }

  /**
   * Refreshes all on-chain fields from a getOrder() call.
   * Sets lastSyncedAt and lastSyncBlock.
   */
  async syncFromChain(
    id: string,
    chainData: SyncFromChainInput,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'syncFromChain', {
      id,
      onChainStatus: chainData.onChainStatus,
      lastSyncBlock: chainData.lastSyncBlock,
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
        where: { id },
        data: {
          onChainStatus: chainData.onChainStatus,
          triggerTick: chainData.triggerTick,
          slippageBps: chainData.slippageBps,
          payoutAddress: chainData.payoutAddress,
          operatorAddress: chainData.operatorAddress,
          owner: chainData.owner,
          pool: chainData.pool,
          validUntil: chainData.validUntil,
          swapDirection: chainData.swapDirection,
          swapSlippageBps: chainData.swapSlippageBps,
          lastSyncBlock: chainData.lastSyncBlock,
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
   * Marks order as ACTIVE on-chain. Sets registration metadata and starts monitoring.
   */
  async markOnChainActive(
    id: string,
    input: { registrationTxHash: string; registeredAt?: Date },
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'markOnChainActive', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
        where: { id },
        data: {
          onChainStatus: OnChainOrderStatus.ACTIVE,
          registrationTxHash: input.registrationTxHash,
          registeredAt: input.registeredAt ?? new Date(),
          monitoringState: 'monitoring',
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
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'markOnChainExecuted', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
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
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'markOnChainCancelled', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
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
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'atomicTransitionToTriggered', { id });

    try {
      const db = tx ?? this.prisma;

      const updateResult = await db.onChainCloseOrder.updateMany({
        where: {
          id,
          monitoringState: 'monitoring',
        },
        data: {
          monitoringState: 'triggered',
        },
      });

      if (updateResult.count === 0) {
        const current = await db.onChainCloseOrder.findUnique({
          where: { id },
          select: { monitoringState: true },
        });
        throw new Error(
          `Failed to transition order ${id} to triggered: ` +
            `current monitoringState='${current?.monitoringState}' (expected 'monitoring'). ` +
            `Race condition detected.`,
        );
      }

      const result = await db.onChainCloseOrder.findUnique({ where: { id } });
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
  ): Promise<OnChainCloseOrder> {
    return this.updateMonitoringState(id, 'monitoring', tx);
  }

  /**
   * Transitions triggered → suspended (max retries exhausted).
   */
  async transitionToSuspended(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    return this.updateMonitoringState(id, 'suspended', tx);
  }

  /**
   * Transitions any → idle (terminal on-chain state reached).
   */
  async transitionToIdle(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    return this.updateMonitoringState(id, 'idle', tx);
  }

  /**
   * Transitions idle → monitoring (order became ACTIVE on-chain).
   */
  async startMonitoring(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    return this.updateMonitoringState(id, 'monitoring', tx);
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async updateMonitoringState(
    id: string,
    newState: MonitoringState,
    tx?: PrismaTransactionClient,
  ): Promise<OnChainCloseOrder> {
    log.methodEntry(this.logger, 'updateMonitoringState', { id, newState });

    try {
      const db = tx ?? this.prisma;
      const result = await db.onChainCloseOrder.update({
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
    options: FindOnChainCloseOrderOptions & { positionId?: string },
  ): Prisma.OnChainCloseOrderWhereInput {
    const where: Prisma.OnChainCloseOrderWhereInput = {};

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

    if (options.triggerMode !== undefined) {
      where.triggerMode = options.triggerMode;
    }

    return where;
  }
}
