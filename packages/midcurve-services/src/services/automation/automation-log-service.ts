/**
 * Automation Log Service
 *
 * Provides operations for creating and querying automation event logs.
 * Logs are scoped to positions and provide user-facing visibility into
 * automation order lifecycle events.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import type { Prisma, AutomationLog } from '@midcurve/database';
import type { PrismaTransactionClient } from '../../clients/index.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import type {
  AutomationLogWriteOptions,
  CreateAutomationLogInput,
  ListAutomationLogsOptions,
  OrderTriggeredContext,
  OrderExecutingContext,
  OrderExecutedContext,
  OrderFailedContext,
  OrderCreatedContext,
  OrderRegisteredContext,
  OrderCancelledContext,
  OrderExpiredContext,
  OrderModifiedContext,
  RetryScheduledContext,
  PreflightValidationContext,
  SimulationFailedContext,
  ExecutionSkippedContext,
} from '../types/automation/index.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Log level constants
 */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * Log type constants for automation events
 */
export const AutomationLogType = {
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_REGISTERED: 'ORDER_REGISTERED',
  ORDER_TRIGGERED: 'ORDER_TRIGGERED',
  ORDER_EXECUTING: 'ORDER_EXECUTING',
  ORDER_EXECUTED: 'ORDER_EXECUTED',
  ORDER_FAILED: 'ORDER_FAILED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_EXPIRED: 'ORDER_EXPIRED',
  ORDER_MODIFIED: 'ORDER_MODIFIED',
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  PREFLIGHT_VALIDATION: 'PREFLIGHT_VALIDATION',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  EXECUTION_SKIPPED: 'EXECUTION_SKIPPED',
} as const;

export type AutomationLogTypeValue =
  (typeof AutomationLogType)[keyof typeof AutomationLogType];

/**
 * Human-readable log level names
 */
const LOG_LEVEL_NAMES: Record<number, string> = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
};

// =============================================================================
// SERVICE
// =============================================================================

/**
 * Dependencies for AutomationLogService
 */
export interface AutomationLogServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;
}

/**
 * Result type for list operations
 */
export interface ListAutomationLogsResult {
  logs: AutomationLog[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Automation Log Service
 *
 * Handles automation log-related database operations including:
 * - Creating log entries for automation events
 * - Listing logs by position with cursor-based pagination
 * - Convenience methods for common log types
 */
export class AutomationLogService {
  private readonly prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  /**
   * Creates a new AutomationLogService instance
   *
   * @param dependencies - Service dependencies
   */
  constructor(dependencies: AutomationLogServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('AutomationLogService');
  }

  // ============================================================================
  // CORE OPERATIONS
  // ============================================================================

  /**
   * Creates a new automation log entry.
   *
   * When the input carries a sourceEventKey, the write is conflict-tolerant:
   * replaying the same on-chain event leaves one row rather than one per replay.
   *
   * The mechanism is `createMany({ skipDuplicates: true })` — `ON CONFLICT DO
   * NOTHING` — rather than catching P2002, and that is not a style preference.
   * Every event-derived log write happens inside an enclosing `$transaction`
   * alongside the state change it describes, and in PostgreSQL a constraint
   * violation aborts the whole transaction server-side: catching the error would
   * leave a dead transaction in which the accompanying `mergeState` also rolls
   * back and every later statement fails. `ON CONFLICT DO NOTHING` conflicts
   * without erroring, so the transaction stays healthy. See #79.
   *
   * @param input - Log creation input
   * @param tx - Transaction client, when the write belongs to a transaction
   * @returns true if a row was written, false if an identical source event had
   *          already been logged for this position
   */
  async log(
    input: CreateAutomationLogInput,
    tx?: PrismaTransactionClient
  ): Promise<boolean> {
    log.methodEntry(this.logger, 'log', {
      positionId: input.positionId,
      logType: input.logType,
      level: input.level,
      sourceEventKey: input.sourceEventKey,
    });

    const data = {
      positionId: input.positionId,
      closeOrderId: input.closeOrderId,
      level: input.level,
      logType: input.logType,
      message: input.message,
      context: input.context as unknown as Prisma.InputJsonValue,
      sourceEventKey: input.sourceEventKey,
    };

    try {
      const db = tx ?? this.prisma;

      // No source event — nothing to deduplicate against, and these writes must
      // stay repeatable. A NULL key never participates in the unique index.
      if (input.sourceEventKey === undefined) {
        const result = await db.automationLog.create({ data });

        this.logger.debug(
          { id: result.id, positionId: result.positionId, logType: result.logType },
          'Automation log created'
        );

        log.methodExit(this.logger, 'log', { id: result.id });
        return true;
      }

      const { count } = await db.automationLog.createMany({
        data: [data],
        skipDuplicates: true,
      });
      const created = count > 0;

      if (created) {
        this.logger.debug(
          {
            positionId: input.positionId,
            logType: input.logType,
            sourceEventKey: input.sourceEventKey,
          },
          'Automation log created'
        );
      } else {
        this.logger.debug(
          {
            positionId: input.positionId,
            logType: input.logType,
            sourceEventKey: input.sourceEventKey,
          },
          'Automation log already recorded for this source event, skipping'
        );
      }

      log.methodExit(this.logger, 'log', { created });
      return created;
    } catch (error) {
      log.methodError(this.logger, 'log', error as Error, { input });
      throw error;
    }
  }

  /**
   * Lists automation logs for a position with cursor-based pagination
   *
   * @param positionId - Position ID to list logs for
   * @param options - Query options
   * @returns Paginated log results
   */
  async listByPosition(
    positionId: string,
    options: ListAutomationLogsOptions = {},
    tx?: PrismaTransactionClient
  ): Promise<ListAutomationLogsResult> {
    const { level, limit = 50, cursor } = options;

    log.methodEntry(this.logger, 'listByPosition', {
      positionId,
      level,
      limit,
      cursor,
    });

    try {
      const db = tx ?? this.prisma;

      // Build where clause
      const where: Prisma.AutomationLogWhereInput = {
        positionId,
      };

      if (level !== undefined) {
        where.level = level;
      }

      // For cursor-based pagination, we need to filter by id < cursor
      if (cursor) {
        where.id = { lt: cursor };
      }

      // Fetch limit + 1 to determine if there are more results
      const logs = await db.automationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      // Determine if there are more results
      const hasMore = logs.length > limit;
      if (hasMore) {
        logs.pop(); // Remove the extra item
      }

      // Get next cursor
      const lastLog = logs[logs.length - 1];
      const nextCursor = hasMore && lastLog ? lastLog.id : null;

      log.methodExit(this.logger, 'listByPosition', {
        count: logs.length,
        hasMore,
      });

      return {
        logs,
        nextCursor,
        hasMore,
      };
    } catch (error) {
      log.methodError(this.logger, 'listByPosition', error as Error, {
        positionId,
        options,
      });
      throw error;
    }
  }

  /**
   * Lists automation logs for a specific close order
   *
   * @param closeOrderId - Close order ID
   * @param options - Query options
   * @returns Paginated log results
   */
  async listByCloseOrder(
    closeOrderId: string,
    options: ListAutomationLogsOptions = {},
    tx?: PrismaTransactionClient
  ): Promise<ListAutomationLogsResult> {
    const { level, limit = 50, cursor } = options;

    log.methodEntry(this.logger, 'listByCloseOrder', {
      closeOrderId,
      level,
      limit,
      cursor,
    });

    try {
      const db = tx ?? this.prisma;

      const where: Prisma.AutomationLogWhereInput = {
        closeOrderId,
      };

      if (level !== undefined) {
        where.level = level;
      }

      if (cursor) {
        where.id = { lt: cursor };
      }

      const logs = await db.automationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });

      const hasMore = logs.length > limit;
      if (hasMore) {
        logs.pop();
      }

      const lastLog = logs[logs.length - 1];
      const nextCursor = hasMore && lastLog ? lastLog.id : null;

      log.methodExit(this.logger, 'listByCloseOrder', {
        count: logs.length,
        hasMore,
      });

      return {
        logs,
        nextCursor,
        hasMore,
      };
    } catch (error) {
      log.methodError(this.logger, 'listByCloseOrder', error as Error, {
        closeOrderId,
        options,
      });
      throw error;
    }
  }

  // ============================================================================
  // CONVENIENCE METHODS
  // ============================================================================

  /**
   * Logs order creation event
   */
  async logOrderCreated(
    positionId: string,
    closeOrderId: string,
    context: OrderCreatedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderCreatedMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_CREATED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order registered on-chain event
   */
  async logOrderRegistered(
    positionId: string,
    closeOrderId: string,
    context: OrderRegisteredContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderRegisteredMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_REGISTERED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order triggered event
   */
  async logOrderTriggered(
    positionId: string,
    closeOrderId: string,
    context: OrderTriggeredContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderTriggeredMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_TRIGGERED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order executing event
   */
  async logOrderExecuting(
    positionId: string,
    closeOrderId: string,
    context: OrderExecutingContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderExecutingMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_EXECUTING,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order executed event
   */
  async logOrderExecuted(
    positionId: string,
    closeOrderId: string,
    context: OrderExecutedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderExecutedMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_EXECUTED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order failed event
   */
  async logOrderFailed(
    positionId: string,
    closeOrderId: string,
    context: OrderFailedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderFailedMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.ERROR,
      logType: AutomationLogType.ORDER_FAILED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order cancelled event
   */
  async logOrderCancelled(
    positionId: string,
    closeOrderId: string,
    context: OrderCancelledContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderCancelledMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_CANCELLED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order expired event
   */
  async logOrderExpired(
    positionId: string,
    closeOrderId: string,
    context: OrderExpiredContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderExpiredMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_EXPIRED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs order modified event
   */
  async logOrderModified(
    positionId: string,
    closeOrderId: string,
    context: OrderModifiedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatOrderModifiedMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.INFO,
      logType: AutomationLogType.ORDER_MODIFIED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs retry scheduled event
   */
  async logRetryScheduled(
    positionId: string,
    closeOrderId: string,
    context: RetryScheduledContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatRetryScheduledMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.WARN,
      logType: AutomationLogType.RETRY_SCHEDULED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs pre-flight validation result
   */
  async logPreflightValidation(
    positionId: string,
    closeOrderId: string,
    context: PreflightValidationContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatPreflightValidationMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: context.isValid ? LogLevel.INFO : LogLevel.ERROR,
      logType: AutomationLogType.PREFLIGHT_VALIDATION,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  /**
   * Logs simulation failure
   */
  async logSimulationFailed(
    positionId: string,
    closeOrderId: string,
    context: SimulationFailedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatSimulationFailedMessage(context);
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.ERROR,
      logType: AutomationLogType.SIMULATION_FAILED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  async logExecutionSkipped(
    positionId: string,
    closeOrderId: string,
    context: ExecutionSkippedContext,
    opts: AutomationLogWriteOptions = {}
  ): Promise<void> {
    const message = this.formatWithOrderTag(
      context.orderTag,
      `Execution skipped: ${context.reason}`
    );
    await this.log({
      positionId,
      closeOrderId,
      level: LogLevel.WARN,
      logType: AutomationLogType.EXECUTION_SKIPPED,
      message,
      context,
      sourceEventKey: opts.sourceEventKey,
    }, opts.tx);
  }

  // ============================================================================
  // MESSAGE FORMATTING
  // ============================================================================

  /**
   * Formats message with order tag prefix
   * All order-related messages should use this pattern: [orderTag] message
   */
  private formatWithOrderTag(orderTag: string, message: string): string {
    return `[${orderTag}] ${message}`;
  }

  private formatOrderCreatedMessage(context: OrderCreatedContext): string {
    return this.formatWithOrderTag(context.orderTag, 'Close order created');
  }

  private formatOrderRegisteredMessage(context: OrderRegisteredContext): string {
    const txShort = context.registrationTxHash.slice(0, 10) + '...';
    return this.formatWithOrderTag(
      context.orderTag,
      `Order registered on-chain (tx: ${txShort})`
    );
  }

  private formatOrderTriggeredMessage(context: OrderTriggeredContext): string {
    return this.formatWithOrderTag(
      context.orderTag,
      `Price crossed trigger (${context.humanTriggerPrice} → ${context.humanCurrentPrice})`
    );
  }

  private formatOrderExecutingMessage(context: OrderExecutingContext): string {
    const txShort = context.txHash
      ? `${context.txHash.slice(0, 10)}...`
      : 'pending';
    return this.formatWithOrderTag(
      context.orderTag,
      `Executing close transaction (tx: ${txShort})`
    );
  }

  private formatOrderExecutedMessage(context: OrderExecutedContext): string {
    const txShort = context.txHash
      ? `${context.txHash.slice(0, 10)}...`
      : 'unknown';
    return this.formatWithOrderTag(
      context.orderTag,
      `Position closed successfully (tx: ${txShort})`
    );
  }

  private formatOrderFailedMessage(context: OrderFailedContext): string {
    const retryInfo = context.willRetry
      ? ` Retry ${context.retryCount + 1}/${context.maxRetries} scheduled.`
      : ' No more retries.';
    return this.formatWithOrderTag(
      context.orderTag,
      `Execution failed: ${context.error}.${retryInfo}`
    );
  }

  private formatRetryScheduledMessage(context: RetryScheduledContext): string {
    const delaySeconds = context.retryDelayMs
      ? Math.round(context.retryDelayMs / 1000)
      : 0;
    const delayInfo = delaySeconds > 0 ? ` after ${delaySeconds}s delay` : '';
    return this.formatWithOrderTag(
      context.orderTag,
      `Retrying execution (attempt ${context.retryCount + 1}/${context.maxRetries})${delayInfo}`
    );
  }

  private formatOrderCancelledMessage(context: OrderCancelledContext): string {
    return this.formatWithOrderTag(
      context.orderTag,
      'Close order cancelled by user'
    );
  }

  private formatOrderExpiredMessage(context: OrderExpiredContext): string {
    return this.formatWithOrderTag(
      context.orderTag,
      `Close order expired (valid until ${context.validUntil})`
    );
  }

  private formatOrderModifiedMessage(context: OrderModifiedContext): string {
    return this.formatWithOrderTag(
      context.orderTag,
      `Close order modified: ${context.changes}`
    );
  }

  private formatPreflightValidationMessage(
    context: PreflightValidationContext
  ): string {
    const message = context.isValid
      ? `Pre-flight validation passed (liquidity: ${context.liquidity})`
      : `Pre-flight validation failed: ${context.reason}`;
    return this.formatWithOrderTag(context.orderTag, message);
  }

  private formatSimulationFailedMessage(
    context: SimulationFailedContext
  ): string {
    return this.formatWithOrderTag(
      context.orderTag,
      `Transaction simulation failed: ${context.decodedError || 'unknown error'}`
    );
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Gets human-readable level name
   */
  static getLevelName(level: number): string {
    return LOG_LEVEL_NAMES[level] || 'UNKNOWN';
  }
}
