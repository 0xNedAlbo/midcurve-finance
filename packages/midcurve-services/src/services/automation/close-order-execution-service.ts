/**
 * Close Order Execution Service
 *
 * Provides CRUD operations and lifecycle management for close order execution attempts.
 * Each execution records the trigger context, execution lifecycle, and result.
 *
 * Execution attempts are separate entities from the order itself,
 * allowing clean tracking of retries.
 *
 * Lifecycle: pending → executing → completed | failed
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { CloseOrderExecution, Prisma } from '@midcurve/database';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import type {
  CreateCloseOrderExecutionInput,
  MarkCloseOrderExecutionCompletedInput,
  MarkCloseOrderExecutionFailedInput,
} from '../types/automation/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies for CloseOrderExecutionService
 */
export interface CloseOrderExecutionServiceDependencies {
  prisma?: PrismaClient;
}

// ============================================================================
// Service
// ============================================================================

export class CloseOrderExecutionService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: CloseOrderExecutionServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('CloseOrderExecutionService');
  }

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  /**
   * Creates a new execution attempt when a trigger is detected.
   * Captures the trigger context (price, timestamp) at detection time.
   */
  async create(
    input: CreateCloseOrderExecutionInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution> {
    log.methodEntry(this.logger, 'create', {
      onChainCloseOrderId: input.onChainCloseOrderId,
      positionId: input.positionId,
    });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrderExecution.create({
        data: {
          onChainCloseOrderId: input.onChainCloseOrderId,
          positionId: input.positionId,
          triggerSqrtPriceX96: input.triggerSqrtPriceX96,
          triggeredAt: input.triggeredAt,
          status: 'pending',
        },
      });

      this.logger.info(
        {
          executionId: result.id,
          onChainCloseOrderId: input.onChainCloseOrderId,
        },
        'Close order execution created',
      );
      log.methodExit(this.logger, 'create', { executionId: result.id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'create', error as Error, { input });
      throw error;
    }
  }

  /**
   * Finds an execution by ID.
   */
  async findById(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution | null> {
    const db = tx ?? this.prisma;
    return db.closeOrderExecution.findUnique({ where: { id } });
  }

  /**
   * Finds all executions for an order, newest first.
   */
  async findByOrderId(
    onChainCloseOrderId: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution[]> {
    const db = tx ?? this.prisma;
    return db.closeOrderExecution.findMany({
      where: { onChainCloseOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Finds the most recent execution for an order.
   * Used by executor to get current attempt.
   */
  async findLatestByOrderId(
    onChainCloseOrderId: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution | null> {
    const db = tx ?? this.prisma;
    const results = await db.closeOrderExecution.findMany({
      where: { onChainCloseOrderId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return results[0] ?? null;
  }

  // ==========================================================================
  // LIFECYCLE OPERATIONS
  // ==========================================================================

  /**
   * Marks execution as executing (pending → executing).
   * Called when the tx is signed and being broadcast.
   */
  async markExecuting(
    id: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution> {
    log.methodEntry(this.logger, 'markExecuting', { id });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrderExecution.update({
        where: { id },
        data: { status: 'executing' },
      });

      this.logger.info({ executionId: id }, 'Execution marked as executing');
      log.methodExit(this.logger, 'markExecuting', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markExecuting', error as Error, { id });
      throw error;
    }
  }

  /**
   * Marks execution as completed (executing → completed).
   * Records tx hash, execution results, and completion time.
   */
  async markCompleted(
    id: string,
    input: MarkCloseOrderExecutionCompletedInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution> {
    log.methodEntry(this.logger, 'markCompleted', { id, txHash: input.txHash });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrderExecution.update({
        where: { id },
        data: {
          status: 'completed',
          txHash: input.txHash,
          executionSqrtPriceX96: input.executionSqrtPriceX96,
          executionFeeBps: input.executionFeeBps,
          amount0Out: input.amount0Out,
          amount1Out: input.amount1Out,
          swapExecution: (input.swapExecution as Prisma.InputJsonValue) ?? undefined,
          completedAt: new Date(),
        },
      });

      this.logger.info(
        { executionId: id, txHash: input.txHash },
        'Execution completed successfully',
      );
      log.methodExit(this.logger, 'markCompleted', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markCompleted', error as Error, {
        id,
        input,
      });
      throw error;
    }
  }

  /**
   * Marks execution as failed (executing → failed).
   * Records error and sets completion time.
   */
  async markFailed(
    id: string,
    input: MarkCloseOrderExecutionFailedInput,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution> {
    log.methodEntry(this.logger, 'markFailed', { id, error: input.error });

    try {
      const db = tx ?? this.prisma;
      const result = await db.closeOrderExecution.update({
        where: { id },
        data: {
          status: 'failed',
          error: input.error,
          completedAt: new Date(),
        },
      });

      this.logger.warn(
        { executionId: id, error: input.error },
        'Execution marked as failed',
      );
      log.methodExit(this.logger, 'markFailed', { id });
      return result;
    } catch (error) {
      log.methodError(this.logger, 'markFailed', error as Error, {
        id,
        input,
      });
      throw error;
    }
  }

  /**
   * Increments retry count and stores latest error.
   * Status stays 'pending' for retry. Used when execution fails but retries remain.
   */
  async incrementRetryCount(
    id: string,
    error: string,
    tx?: PrismaTransactionClient,
  ): Promise<CloseOrderExecution> {
    log.methodEntry(this.logger, 'incrementRetryCount', { id, error });

    try {
      const db = tx ?? this.prisma;
      const existing = await db.closeOrderExecution.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new Error(`Close order execution not found: ${id}`);
      }

      const result = await db.closeOrderExecution.update({
        where: { id },
        data: {
          retryCount: existing.retryCount + 1,
          error,
          status: 'pending',
        },
      });

      this.logger.warn(
        { executionId: id, retryCount: result.retryCount, error },
        'Execution retry count incremented',
      );
      log.methodExit(this.logger, 'incrementRetryCount', {
        id,
        retryCount: result.retryCount,
      });
      return result;
    } catch (err) {
      log.methodError(this.logger, 'incrementRetryCount', err as Error, {
        id,
        error,
      });
      throw err;
    }
  }
}
