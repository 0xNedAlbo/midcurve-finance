/**
 * Onchain Data Logging Utilities
 *
 * Provides structured logging for onchain data workers using Pino from @midcurve/services.
 * Includes worker-specific logging patterns for WebSocket subscriptions, price events, etc.
 */

import { createServiceLogger, LogPatterns } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';

/**
 * Base onchain data logger instance
 */
export const onchainDataLogger = createServiceLogger('MidcurveOnchainData');

/**
 * @deprecated Use onchainDataLogger instead. Kept for backward compatibility during migration.
 */
export const poolPricesLogger = onchainDataLogger;

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
 * Pool prices-specific logging patterns
 */
export const priceLog = {
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
   * Log worker lifecycle event
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
   * Log WebSocket connection event
   */
  wsConnection(
    logger: ServiceLogger,
    chainId: number,
    event: 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      chainId,
      event,
      ...metadata,
      msg: `WebSocket chain ${chainId}: ${event}`,
    });
  },

  /**
   * Log subscription event
   */
  subscription(
    logger: ServiceLogger,
    chainId: number,
    event: 'subscribed' | 'unsubscribed' | 'error',
    poolCount: number,
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      chainId,
      event,
      poolCount,
      ...metadata,
      msg: `Subscription chain ${chainId}: ${event} (${poolCount} pools)`,
    });
  },

  /**
   * Log incoming price event
   */
  priceEvent(
    logger: ServiceLogger,
    chainId: number,
    poolAddress: string,
    blockNumber: number,
    removed: boolean
  ): void {
    logger.debug({
      chainId,
      poolAddress,
      blockNumber,
      removed,
      msg: `Price event: ${poolAddress} block ${blockNumber}${removed ? ' (removed)' : ''}`,
    });
  },

  /**
   * Log RabbitMQ event
   */
  mqEvent(
    logger: ServiceLogger,
    event: 'connected' | 'disconnected' | 'published' | 'error',
    metadata?: Record<string, unknown>
  ): void {
    const level = event === 'error' ? 'error' : 'info';
    logger[level]({
      event,
      ...metadata,
      msg: `MQ ${event}`,
    });
  },

  /**
   * Log batch statistics
   */
  batchStats(
    logger: ServiceLogger,
    chainId: number,
    batchIndex: number,
    poolCount: number,
    connected: boolean
  ): void {
    logger.info({
      chainId,
      batchIndex,
      poolCount,
      connected,
      msg: `Batch ${chainId}#${batchIndex}: ${poolCount} pools, ${connected ? 'connected' : 'disconnected'}`,
    });
  },
};

/**
 * Re-export service logger type for convenience
 */
export type { ServiceLogger };
