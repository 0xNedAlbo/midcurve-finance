/**
 * Business Logic Logging Utilities
 *
 * Provides structured logging for business logic rules using Pino from @midcurve/services.
 * Includes rule-specific logging patterns for lifecycle, event processing, etc.
 */

import { createServiceLogger, LogPatterns } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';

/**
 * Base business logic logger instance
 */
export const businessLogicLogger = createServiceLogger('MidcurveBusinessLogic');

/**
 * Convert unknown error to Error instance
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Business logic-specific logging patterns
 */
export const ruleLog = {
  /**
   * Re-export service patterns
   */
  dbOperation: LogPatterns.dbOperation,
  methodEntry: LogPatterns.methodEntry,
  methodExit: LogPatterns.methodExit,

  /**
   * Log method error
   */
  methodError(
    logger: ServiceLogger,
    method: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    LogPatterns.methodError(logger, method, toError(error), context);
  },

  /**
   * Log worker lifecycle event (for RuleManager)
   */
  workerLifecycle(
    logger: ServiceLogger,
    worker: string,
    event: 'starting' | 'started' | 'stopping' | 'stopped' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      worker,
      event,
      ...metadata,
      msg: `Worker ${worker} ${event}`,
    });
  },

  /**
   * Log rule lifecycle event
   */
  ruleLifecycle(
    logger: ServiceLogger,
    ruleName: string,
    event: 'starting' | 'started' | 'stopping' | 'stopped' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      ruleName,
      event,
      ...metadata,
      msg: `Rule ${ruleName} ${event}`,
    });
  },

  /**
   * Log rule event processing
   */
  eventProcessing(
    logger: ServiceLogger,
    ruleName: string,
    eventType: string,
    entityId: string,
    metadata?: Record<string, unknown>
  ): void {
    logger.debug({
      ruleName,
      eventType,
      entityId,
      ...metadata,
      msg: `Processing ${eventType} for ${entityId}`,
    });
  },

  /**
   * Log rule event processed successfully
   */
  eventProcessed(
    logger: ServiceLogger,
    ruleName: string,
    eventType: string,
    entityId: string,
    durationMs: number,
    metadata?: Record<string, unknown>
  ): void {
    logger.debug({
      ruleName,
      eventType,
      entityId,
      durationMs,
      ...metadata,
      msg: `Processed ${eventType} for ${entityId} in ${durationMs}ms`,
    });
  },

  /**
   * Log RabbitMQ event
   */
  mqEvent(
    logger: ServiceLogger,
    event: 'connected' | 'disconnected' | 'published' | 'consumed' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      event,
      ...metadata,
      msg: `MQ ${event}`,
    });
  },
};

/**
 * Re-export service logger type for convenience
 */
export type { ServiceLogger };
