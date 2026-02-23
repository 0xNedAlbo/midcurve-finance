/**
 * UniswapV3 Close Order Service
 *
 * Provides CRUD operations, lifecycle management, and on-chain integration
 * for UniswapV3 close orders.
 *
 * Key concepts:
 * - protocol: 'uniswapv3'
 * - config: immutable identity data (JSON) — chainId, nftId, contractAddress, etc.
 * - state: mutable on-chain state (JSON) — triggerTick, pool, slippage, etc.
 * - orderIdentityHash: unique identifier, e.g. "uniswapv3/{chainId}/{nftId}/{triggerMode}"
 * - automationState: single lifecycle field (inactive|monitoring|executing|retrying|failed|executed)
 *     inactive = stored for display only, operator is not our automation wallet
 * - executionAttempts: retry counter, resets when price moves away from trigger
 *
 * DB lifecycle driven by on-chain events:
 * - OrderRegistered → INSERT (automationState=monitoring if we are operator, inactive otherwise)
 * - OrderCancelled → DELETE
 * - OrderExecuted → UPDATE automationState=executed
 * - Re-registration at same slot → DELETE old, INSERT new
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { CloseOrder, Prisma } from '@midcurve/database';
import { ContractTriggerMode, OnChainOrderStatus, compareAddresses } from '@midcurve/shared';
import type { ContractSwapDirection } from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import { EvmConfig } from '../../config/evm.js';
import { deriveCloseOrderHashFromTick } from '../../utils/automation/close-order-hash.js';
import { SharedContractService } from '../automation/shared-contract-service.js';
import type {
  CreateCloseOrderInput,
  SyncFromChainInput,
  FindCloseOrderOptions,
} from '../types/automation/index.js';

// ============================================================================
// ABI (minimal — only getOrder)
// ============================================================================

const POSITION_CLOSER_GET_ORDER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'nftId', type: 'uint256' },
      { internalType: 'uint8', name: 'triggerMode', type: 'uint8' },
    ],
    name: 'getOrder',
    outputs: [
      {
        internalType: 'struct CloseOrder',
        name: 'order',
        type: 'tuple',
        components: [
          { internalType: 'enum OrderStatus', name: 'status', type: 'uint8' },
          { internalType: 'uint256', name: 'nftId', type: 'uint256' },
          { internalType: 'address', name: 'owner', type: 'address' },
          { internalType: 'address', name: 'pool', type: 'address' },
          { internalType: 'int24', name: 'triggerTick', type: 'int24' },
          { internalType: 'address', name: 'payout', type: 'address' },
          { internalType: 'address', name: 'operator', type: 'address' },
          { internalType: 'uint256', name: 'validUntil', type: 'uint256' },
          { internalType: 'uint16', name: 'slippageBps', type: 'uint16' },
          { internalType: 'enum SwapDirection', name: 'swapDirection', type: 'uint8' },
          { internalType: 'uint16', name: 'swapSlippageBps', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================================================
// Types
// ============================================================================

/**
 * On-chain order data returned by getOrder().
 * Only populated when status !== NONE.
 */
interface OnChainOrder {
  status: number;
  nftId: bigint;
  owner: string;
  pool: string;
  triggerTick: number;
  payout: string;
  operator: string;
  validUntil: bigint;
  slippageBps: number;
  swapDirection: ContractSwapDirection;
  swapSlippageBps: number;
}

/**
 * Dependencies for UniswapV3CloseOrderService
 */
export interface UniswapV3CloseOrderServiceDependencies {
  prisma?: PrismaClient;
  sharedContractService?: SharedContractService;
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

/**
 * Result of discover() — returns discovered orders and counts.
 */
export interface DiscoverCloseOrdersResult {
  /** All close orders for the position (existing + newly discovered) */
  orders: CloseOrder[];
  /** Number of new orders discovered from on-chain */
  discovered: number;
  /** Number of orders already tracked in DB */
  existing: number;
}

/**
 * Result of refresh() — the updated order, or null if it was deleted
 * (e.g. cancelled on-chain).
 */
export type RefreshCloseOrderResult = CloseOrder | null;

// ============================================================================
// Service
// ============================================================================

export class UniswapV3CloseOrderService {
  private readonly prisma: PrismaClient;
  private readonly sharedContractService: SharedContractService;
  private readonly logger: ServiceLogger;

  readonly protocol = 'uniswapv3' as const;

  constructor(dependencies: UniswapV3CloseOrderServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.sharedContractService = dependencies.sharedContractService ?? new SharedContractService();
    this.logger = createServiceLogger('UniswapV3CloseOrderService');
  }

  // ==========================================================================
  // DISCOVERY & REFRESH (to be implemented)
  // ==========================================================================

  /**
   * Discover close orders for a position from on-chain data.
   *
   * Reads the PositionCloser contract for both trigger modes (LOWER, UPPER),
   * creates DB records for any ACTIVE orders not already tracked, and returns all.
   */
  async discover(
    positionId: string,
    tx?: PrismaTransactionClient,
  ): Promise<DiscoverCloseOrdersResult> {
    log.methodEntry(this.logger, 'discover', { positionId });

    try {
      const db = tx ?? this.prisma;

      // 1. Fetch position to get chainId and nftId
      const position = await db.position.findUnique({ where: { id: positionId } });
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }
      const posConfig = position.config as Record<string, unknown>;
      const chainId = posConfig.chainId as number;
      const nftId = String(posConfig.nftId);

      // 1b. Look up user's EVM automation wallet to check operator ownership
      const autoWallet = await db.automationWallet.findFirst({
        where: {
          userId: position.userId,
          walletType: 'evm',
          walletPurpose: 'automation',
          isActive: true,
        },
      });
      const ourOperatorAddress = autoWallet
        ? (autoWallet.config as { walletAddress?: string }).walletAddress ?? null
        : null;

      // 2. Find the PositionCloser contract for this chain
      const sharedContract = await this.sharedContractService.findLatestByChainAndName(
        chainId,
        'UniswapV3PositionCloser',
      );
      if (!sharedContract) {
        throw new Error(
          `No UniswapV3PositionCloser contract found for chain ${chainId}`,
        );
      }
      const contractAddress = sharedContract.config.address;

      // 3. Read on-chain orders for both trigger modes
      const orders: CloseOrder[] = [];
      let discovered = 0;
      let existing = 0;

      const triggerModes = [ContractTriggerMode.LOWER, ContractTriggerMode.UPPER] as const;

      for (const triggerMode of triggerModes) {
        const onChain = await this.readOnChainOrder(
          chainId,
          contractAddress,
          BigInt(nftId),
          triggerMode,
        );

        // Skip non-active slots
        if (!onChain || onChain.status !== OnChainOrderStatus.ACTIVE) {
          continue;
        }

        // 4. Check if already tracked in DB
        const orderIdentityHash = `uniswapv3/${chainId}/${nftId}/${triggerMode}`;
        const existingOrder = await this.findByOrderIdentityHash(orderIdentityHash, tx);

        if (existingOrder) {
          orders.push(existingOrder);
          existing++;
        } else {
          // 5. Create new order from on-chain data
          const closeOrderHash = deriveCloseOrderHashFromTick(
            triggerMode,
            onChain.triggerTick,
          );

          // Determine if we are the operator for this order
          const isOurOrder = ourOperatorAddress !== null
            && compareAddresses(onChain.operator, ourOperatorAddress) === 0;

          const newOrder = await this.create(
            {
              protocol: this.protocol,
              positionId,
              sharedContractId: sharedContract.id,
              orderIdentityHash,
              closeOrderHash,
              automationState: isOurOrder ? 'monitoring' : 'inactive',
              config: {
                chainId,
                nftId,
                triggerMode,
                contractAddress,
              },
              state: {
                triggerTick: onChain.triggerTick,
                slippageBps: onChain.slippageBps,
                payoutAddress: onChain.payout,
                operatorAddress: onChain.operator,
                owner: onChain.owner,
                pool: onChain.pool,
                validUntil: new Date(Number(onChain.validUntil) * 1000).toISOString(),
                swapDirection: onChain.swapDirection,
                swapSlippageBps: onChain.swapSlippageBps,
                discoveredAt: new Date().toISOString(),
              },
            },
            tx,
          );

          orders.push(newOrder);
          discovered++;
        }
      }

      this.logger.info(
        { positionId, discovered, existing },
        'Close order discovery complete',
      );
      log.methodExit(this.logger, 'discover', { discovered, existing });
      return { orders, discovered, existing };
    } catch (error) {
      log.methodError(this.logger, 'discover', error as Error, { positionId });
      throw error;
    }
  }

  /**
   * Refresh a close order's state from on-chain data.
   *
   * Reads the current on-chain state via getOrder(nftId, triggerMode)
   * and updates the DB record. May delete if cancelled on-chain.
   */
  async refresh(
    _id: string,
    _tx?: PrismaTransactionClient,
  ): Promise<RefreshCloseOrderResult> {
    throw new Error(
      'UniswapV3CloseOrderService.refresh() is not yet implemented.',
    );
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

  /**
   * Reads a single on-chain order via getOrder(nftId, triggerMode).
   * Returns the full order struct, or null if status is NONE.
   */
  private async readOnChainOrder(
    chainId: number,
    contractAddress: string,
    nftId: bigint,
    triggerMode: ContractTriggerMode,
  ): Promise<OnChainOrder | null> {
    const client = EvmConfig.getInstance().getPublicClient(chainId);

    const result = await client.readContract({
      address: contractAddress as `0x${string}`,
      abi: POSITION_CLOSER_GET_ORDER_ABI,
      functionName: 'getOrder',
      args: [nftId, triggerMode],
    });

    if (result.status === OnChainOrderStatus.NONE) {
      return null;
    }

    return {
      status: result.status,
      nftId: result.nftId,
      owner: result.owner,
      pool: result.pool,
      triggerTick: result.triggerTick,
      payout: result.payout,
      operator: result.operator,
      validUntil: result.validUntil,
      slippageBps: result.slippageBps,
      swapDirection: result.swapDirection as ContractSwapDirection,
      swapSlippageBps: result.swapSlippageBps,
    };
  }

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
