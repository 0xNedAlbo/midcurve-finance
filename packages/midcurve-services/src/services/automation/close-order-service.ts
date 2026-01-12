/**
 * Close Order Service
 *
 * Provides CRUD operations and lifecycle management for close orders.
 * Close orders represent registered triggers for automated position closing.
 */

import { PrismaClient } from '@midcurve/database';
import type { Prisma } from '@midcurve/database';
import {
  CloseOrderFactory,
  type CloseOrderInterface,
  type CloseOrderType,
  type CloseOrderStatus,
} from '@midcurve/shared';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  RegisterCloseOrderInput,
  UpdateCloseOrderInput,
  FindCloseOrderOptions,
  MarkOrderRegisteredInput,
  MarkOrderTriggeredInput,
  MarkOrderExecutedInput,
} from '../types/automation/index.js';

/**
 * Dependencies for CloseOrderService
 */
export interface CloseOrderServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Close Order Service
 *
 * Handles all close order-related database operations including:
 * - Registering new close orders
 * - Finding orders by various criteria
 * - Managing order lifecycle (register -> active -> triggered -> executed)
 * - Cancelling orders
 */
export class CloseOrderService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new CloseOrderService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: CloseOrderServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('CloseOrderService');
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Registers a new close order (status: active)
   *
   * In the shared contract model, orders are registered on-chain first,
   * then notified to the API. The order is created directly in 'active' status.
   *
   * @param input - Close order registration input (includes closeId and registrationTxHash)
   * @returns The created close order
   */
  async register(input: RegisterCloseOrderInput): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'register', {
      closeOrderType: input.closeOrderType,
      positionId: input.positionId,
      chainId: input.automationContractConfig.chainId,
      closeId: input.closeId,
    });

    try {
      // Create config and state based on order type
      const config = this.createConfig(input);
      const state = this.createInitialState(input);

      const result = await this.prisma.automationCloseOrder.create({
        data: {
          closeOrderType: input.closeOrderType,
          positionId: input.positionId,
          status: 'active', // Already registered on-chain
          automationContractConfig:
            input.automationContractConfig as unknown as Prisma.InputJsonValue,
          config: config as unknown as Prisma.InputJsonValue,
          state: state as unknown as Prisma.InputJsonValue,
        },
      });

      const order = this.mapToOrder(result);

      this.logger.info(
        {
          id: order.id,
          positionId: order.positionId,
          closeOrderType: order.closeOrderType,
          closeId: input.closeId,
        },
        'Close order registered'
      );

      log.methodExit(this.logger, 'register', { id: order.id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'register', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds a close order by ID
   *
   * @param id - Order ID
   * @returns The order if found, null otherwise
   */
  async findById(id: string): Promise<CloseOrderInterface | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      const result = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      const order = this.mapToOrder(result);
      log.methodExit(this.logger, 'findById', { id, found: true });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Finds close orders by position ID
   *
   * @param positionId - Position ID
   * @param options - Find options for filtering
   * @returns Array of close orders
   */
  async findByPositionId(
    positionId: string,
    options: FindCloseOrderOptions = {}
  ): Promise<CloseOrderInterface[]> {
    log.methodEntry(this.logger, 'findByPositionId', { positionId, options });

    try {
      const whereClause = this.buildWhereClause({ ...options, positionId });

      const results = await this.prisma.automationCloseOrder.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
      });

      const orders = results.map((r) => this.mapToOrder(r));

      log.methodExit(this.logger, 'findByPositionId', {
        positionId,
        count: orders.length,
      });
      return orders;
    } catch (error) {
      log.methodError(this.logger, 'findByPositionId', error as Error, {
        positionId,
        options,
      });
      throw error;
    }
  }

  /**
   * Finds all active orders for a pool (used by price monitor)
   *
   * @param poolAddress - Pool address
   * @returns Array of active close orders for the pool
   */
  async findActiveOrdersForPool(
    poolAddress: string
  ): Promise<CloseOrderInterface[]> {
    log.methodEntry(this.logger, 'findActiveOrdersForPool', { poolAddress });

    try {
      // Get all active orders
      const results = await this.prisma.automationCloseOrder.findMany({
        where: {
          status: 'active',
        },
      });

      // Filter by pool address in config
      const poolOrders = results.filter((r) => {
        const config = r.config as Record<string, unknown>;
        return config.poolAddress === poolAddress;
      });

      const orders = poolOrders.map((r) => this.mapToOrder(r));

      log.methodExit(this.logger, 'findActiveOrdersForPool', {
        poolAddress,
        count: orders.length,
      });
      return orders;
    } catch (error) {
      log.methodError(this.logger, 'findActiveOrdersForPool', error as Error, {
        poolAddress,
      });
      throw error;
    }
  }

  /**
   * Gets all unique pool addresses with active orders
   *
   * @returns Array of pool addresses
   */
  async getActivePoolAddresses(): Promise<string[]> {
    log.methodEntry(this.logger, 'getActivePoolAddresses', {});

    try {
      const results = await this.prisma.automationCloseOrder.findMany({
        where: { status: 'active' },
        select: { config: true },
      });

      const poolAddresses = new Set<string>();
      for (const r of results) {
        const config = r.config as Record<string, unknown>;
        if (config.poolAddress) {
          poolAddresses.add(config.poolAddress as string);
        }
      }

      const addresses = Array.from(poolAddresses);
      log.methodExit(this.logger, 'getActivePoolAddresses', {
        count: addresses.length,
      });
      return addresses;
    } catch (error) {
      log.methodError(
        this.logger,
        'getActivePoolAddresses',
        error as Error,
        {}
      );
      throw error;
    }
  }

  // ============================================================================
  // LIFECYCLE OPERATIONS
  // ============================================================================

  /**
   * Marks order as registering (pending -> registering)
   *
   * @param id - Order ID
   * @returns The updated order
   */
  async markRegistering(id: string): Promise<CloseOrderInterface> {
    return this.updateStatus(id, 'registering');
  }

  /**
   * Marks order as registered/active (registering -> active)
   *
   * @param id - Order ID
   * @param input - Registration info from blockchain
   * @returns The updated order
   */
  async markRegistered(
    id: string,
    input: MarkOrderRegisteredInput
  ): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'markRegistered', { id, input });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Update config with closeId
      const config = existing.config as Record<string, unknown>;
      const updatedConfig = {
        ...config,
        closeId: input.closeId,
      };

      // Update state with registration info
      const state = existing.state as Record<string, unknown>;
      const updatedState = {
        ...state,
        registrationTxHash: input.registrationTxHash,
        registeredAt: new Date().toISOString(),
      };

      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: {
          status: 'active',
          config: updatedConfig as unknown as Prisma.InputJsonValue,
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      const order = this.mapToOrder(result);

      this.logger.info(
        { id: order.id, closeId: input.closeId },
        'Close order marked as registered/active'
      );

      log.methodExit(this.logger, 'markRegistered', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'markRegistered', error as Error, {
        id,
        input,
      });
      throw error;
    }
  }

  /**
   * Marks order as triggering (active -> triggering)
   *
   * Uses atomic conditional update to prevent race conditions where multiple
   * trigger messages attempt to execute the same order concurrently.
   *
   * @param id - Order ID
   * @param input - Trigger info
   * @returns The updated order
   * @throws Error if order not found or not in 'active' status
   */
  async markTriggered(
    id: string,
    input: MarkOrderTriggeredInput
  ): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'markTriggered', { id, input });

    try {
      // First fetch to get existing state and validate order exists
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Early check for status - provides clear error message
      if (existing.status !== 'active') {
        throw new Error(
          `Cannot trigger order ${id}: expected status 'active', got '${existing.status}'. ` +
            `This may indicate a duplicate trigger message (race condition).`
        );
      }

      // Update state with trigger info
      const state = existing.state as Record<string, unknown>;
      const updatedState = {
        ...state,
        triggeredAt: new Date().toISOString(),
        triggerSqrtPriceX96: input.triggerSqrtPriceX96.toString(),
      };

      // Atomic conditional update: only update if status is still 'active'
      // This prevents race conditions where status changed between findUnique and update
      const updateResult = await this.prisma.automationCloseOrder.updateMany({
        where: {
          id,
          status: 'active', // Only update if still active
        },
        data: {
          status: 'triggering',
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      // If no rows were updated, status changed between check and update (race condition)
      if (updateResult.count === 0) {
        // Fetch current status for error message
        const current = await this.prisma.automationCloseOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new Error(
          `Failed to trigger order ${id}: status changed to '${current?.status}' ` +
            `during processing (race condition detected).`
        );
      }

      // Fetch the updated record to return
      const result = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!result) {
        throw new Error(`Close order ${id} not found after update`);
      }

      const order = this.mapToOrder(result);

      this.logger.info({ id: order.id }, 'Close order marked as triggering');
      log.methodExit(this.logger, 'markTriggered', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'markTriggered', error as Error, {
        id,
        input,
      });
      throw error;
    }
  }

  /**
   * Marks order as executed (triggering -> executed)
   *
   * @param id - Order ID
   * @param input - Execution info
   * @returns The updated order
   */
  async markExecuted(
    id: string,
    input: MarkOrderExecutedInput
  ): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'markExecuted', { id, input });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Update state with execution info
      const state = existing.state as Record<string, unknown>;
      const updatedState = {
        ...state,
        executionTxHash: input.executionTxHash,
        executedAt: new Date().toISOString(),
        executionFeeBps: input.executionFeeBps,
        amount0Out: input.amount0Out.toString(),
        amount1Out: input.amount1Out.toString(),
      };

      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: {
          status: 'executed',
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      const order = this.mapToOrder(result);

      this.logger.info(
        {
          id: order.id,
          executionTxHash: input.executionTxHash,
        },
        'Close order marked as executed'
      );

      log.methodExit(this.logger, 'markExecuted', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'markExecuted', error as Error, {
        id,
        input,
      });
      throw error;
    }
  }

  /**
   * Increments execution attempt counter and records error
   * Used for retry tracking without changing order status
   *
   * @param id - Order ID
   * @param error - Error message from execution attempt
   * @returns Object containing updated retry count
   */
  async incrementExecutionAttempt(
    id: string,
    error: string
  ): Promise<{ retryCount: number }> {
    log.methodEntry(this.logger, 'incrementExecutionAttempt', { id, error });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Increment retry count and store error in state
      const state = existing.state as Record<string, unknown>;
      const retryCount = ((state.retryCount as number) || 0) + 1;
      const updatedState = {
        ...state,
        executionError: error,
        retryCount,
        lastExecutionAt: new Date().toISOString(),
      };

      await this.prisma.automationCloseOrder.update({
        where: { id },
        data: {
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      this.logger.warn(
        { id, retryCount, error },
        'Close order execution attempt recorded'
      );

      log.methodExit(this.logger, 'incrementExecutionAttempt', { id, retryCount });
      return { retryCount };
    } catch (err) {
      log.methodError(this.logger, 'incrementExecutionAttempt', err as Error, {
        id,
        error,
      });
      throw err;
    }
  }

  /**
   * Marks order as failed
   *
   * @param id - Order ID
   * @param error - Error message
   * @returns The updated order
   */
  async markFailed(id: string, error: string): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'markFailed', { id, error });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Update state with error info and increment retry count
      const state = existing.state as Record<string, unknown>;
      const retryCount = ((state.retryCount as number) || 0) + 1;
      const updatedState = {
        ...state,
        executionError: error,
        retryCount,
      };

      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: {
          status: 'failed',
          state: updatedState as unknown as Prisma.InputJsonValue,
        },
      });

      const order = this.mapToOrder(result);

      this.logger.warn({ id: order.id, error }, 'Close order marked as failed');
      log.methodExit(this.logger, 'markFailed', { id });
      return order;
    } catch (err) {
      log.methodError(this.logger, 'markFailed', err as Error, { id, error });
      throw err;
    }
  }

  /**
   * Cancels an order (any non-terminal state -> cancelled)
   *
   * @param id - Order ID
   * @returns The updated order
   */
  async cancel(id: string): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'cancel', { id });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      const terminalStates: CloseOrderStatus[] = [
        'executed',
        'cancelled',
        'expired',
        'failed',
      ];
      if (terminalStates.includes(existing.status as CloseOrderStatus)) {
        throw new Error(
          `Cannot cancel order in terminal state: ${existing.status}`
        );
      }

      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: { status: 'cancelled' },
      });

      const order = this.mapToOrder(result);

      this.logger.info({ id: order.id }, 'Close order cancelled');
      log.methodExit(this.logger, 'cancel', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'cancel', error as Error, { id });
      throw error;
    }
  }

  /**
   * Updates order configuration (only allowed in certain states)
   *
   * @param id - Order ID
   * @param input - Update input
   * @returns The updated order
   */
  async update(
    id: string,
    input: UpdateCloseOrderInput
  ): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      const existing = await this.prisma.automationCloseOrder.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order not found: ${id}`);
      }

      // Only allow updates in pending or active state
      if (existing.status !== 'pending' && existing.status !== 'active') {
        throw new Error(
          `Cannot update order in state: ${existing.status}. ` +
            `Order must be in pending or active state.`
        );
      }

      const config = existing.config as Record<string, unknown>;
      const updatedConfig = { ...config };

      if (input.sqrtPriceX96Lower !== undefined) {
        updatedConfig.sqrtPriceX96Lower = input.sqrtPriceX96Lower.toString();
      }
      if (input.sqrtPriceX96Upper !== undefined) {
        updatedConfig.sqrtPriceX96Upper = input.sqrtPriceX96Upper.toString();
      }
      if (input.slippageBps !== undefined) {
        updatedConfig.slippageBps = input.slippageBps;
      }

      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: {
          config: updatedConfig as unknown as Prisma.InputJsonValue,
        },
      });

      const order = this.mapToOrder(result);

      this.logger.info({ id: order.id }, 'Close order updated');
      log.methodExit(this.logger, 'update', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'update', error as Error, { id, input });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Updates order status
   */
  private async updateStatus(
    id: string,
    newStatus: CloseOrderStatus
  ): Promise<CloseOrderInterface> {
    log.methodEntry(this.logger, 'updateStatus', { id, newStatus });

    try {
      const result = await this.prisma.automationCloseOrder.update({
        where: { id },
        data: { status: newStatus },
      });

      const order = this.mapToOrder(result);

      this.logger.info(
        { id: order.id, status: newStatus },
        'Close order status updated'
      );

      log.methodExit(this.logger, 'updateStatus', { id });
      return order;
    } catch (error) {
      log.methodError(this.logger, 'updateStatus', error as Error, {
        id,
        newStatus,
      });
      throw error;
    }
  }

  /**
   * Builds Prisma where clause from options
   */
  private buildWhereClause(
    options: FindCloseOrderOptions
  ): Prisma.AutomationCloseOrderWhereInput {
    const where: Prisma.AutomationCloseOrderWhereInput = {};

    if (options.closeOrderType) {
      where.closeOrderType = options.closeOrderType;
    }

    if (options.status) {
      if (Array.isArray(options.status)) {
        where.status = { in: options.status };
      } else {
        where.status = options.status;
      }
    }

    if (options.positionId) {
      where.positionId = options.positionId;
    }

    return where;
  }

  /**
   * Creates config from input based on order type
   */
  private createConfig(
    input: RegisterCloseOrderInput
  ): Record<string, unknown> {
    switch (input.closeOrderType) {
      case 'uniswapv3':
        return {
          closeId: input.closeId,
          nftId: input.nftId.toString(),
          poolAddress: input.poolAddress,
          triggerMode: input.triggerMode,
          sqrtPriceX96Lower: input.sqrtPriceX96Lower?.toString() || '0',
          sqrtPriceX96Upper: input.sqrtPriceX96Upper?.toString() || '0',
          priceLowerDisplay: input.priceLowerDisplay,
          priceUpperDisplay: input.priceUpperDisplay,
          payoutAddress: input.payoutAddress,
          operatorAddress: input.operatorAddress,
          validUntil: input.validUntil.toISOString(),
          slippageBps: input.slippageBps,
          // Optional swap config for post-close swap
          swapConfig: input.swapConfig
            ? {
                enabled: input.swapConfig.enabled,
                direction: input.swapConfig.direction,
                slippageBps: input.swapConfig.slippageBps,
                quoteToken: input.swapConfig.quoteToken,
              }
            : undefined,
        };
      default:
        throw new Error(`Unknown close order type: ${input.closeOrderType}`);
    }
  }

  /**
   * Creates initial state based on order type
   * Includes registration info since orders are registered on-chain first
   */
  private createInitialState(
    input: RegisterCloseOrderInput
  ): Record<string, unknown> {
    switch (input.closeOrderType) {
      case 'uniswapv3':
        return {
          registrationTxHash: input.registrationTxHash,
          registeredAt: new Date().toISOString(),
          triggeredAt: null,
          triggerSqrtPriceX96: null,
          executionTxHash: null,
          executedAt: null,
          executionFeeBps: null,
          executionError: null,
          retryCount: 0,
          amount0Out: null,
          amount1Out: null,
        };
      default:
        throw new Error(`Unknown close order type: ${input.closeOrderType}`);
    }
  }

  /**
   * Maps database result to typed order using factory pattern
   */
  private mapToOrder(
    dbResult: Prisma.AutomationCloseOrderGetPayload<Record<string, never>>
  ): CloseOrderInterface {
    // Use factory for runtime type dispatch
    return CloseOrderFactory.fromDB({
      id: dbResult.id,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      closeOrderType: dbResult.closeOrderType as CloseOrderType,
      automationContractConfig: dbResult.automationContractConfig as Record<
        string,
        unknown
      >,
      positionId: dbResult.positionId,
      status: dbResult.status as CloseOrderStatus,
      config: dbResult.config as Record<string, unknown>,
      state: dbResult.state as Record<string, unknown>,
    });
  }
}
