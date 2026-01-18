/**
 * Automation Logging Utilities
 *
 * Provides structured logging for automation workers using Pino from @midcurve/services.
 * Includes worker-specific logging patterns for order processing, price monitoring, etc.
 */

import { createServiceLogger, LogPatterns } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';

/**
 * Base automation logger instance
 */
export const automationLogger = createServiceLogger('MidcurveAutomation');

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
 * Automation-specific logging patterns
 */
export const autoLog = {
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
   * Log price monitor poll
   */
  pricePoll(
    logger: ServiceLogger,
    poolsMonitored: number,
    triggeredOrders: number,
    durationMs: number
  ): void {
    logger.info({
      poolsMonitored,
      triggeredOrders,
      durationMs,
      msg: `Price poll: ${poolsMonitored} pools, ${triggeredOrders} triggered (${durationMs}ms)`,
    });
  },

  /**
   * Log order state transition
   */
  orderTransition(
    logger: ServiceLogger,
    orderId: string,
    fromState: string,
    toState: string,
    metadata?: Record<string, unknown>
  ): void {
    logger.info({
      orderId,
      fromState,
      toState,
      ...metadata,
      msg: `Order ${orderId}: ${fromState} -> ${toState}`,
    });
  },

  /**
   * Log order trigger
   */
  orderTriggered(
    logger: ServiceLogger,
    orderId: string,
    positionId: string,
    poolAddress: string,
    currentPrice: string,
    triggerPrice: string
  ): void {
    logger.info({
      orderId,
      positionId,
      poolAddress,
      currentPrice,
      triggerPrice,
      msg: `Order ${orderId} triggered at price ${currentPrice}`,
    });
  },

  /**
   * Log transaction broadcast
   */
  txBroadcast(
    logger: ServiceLogger,
    chainId: number,
    txHash: string,
    operation: string,
    metadata?: Record<string, unknown>
  ): void {
    logger.info({
      chainId,
      txHash,
      operation,
      ...metadata,
      msg: `TX broadcast: ${operation} on chain ${chainId}`,
    });
  },

  /**
   * Log transaction confirmation
   */
  txConfirmed(
    logger: ServiceLogger,
    chainId: number,
    txHash: string,
    blockNumber: number,
    gasUsed: string
  ): void {
    logger.info({
      chainId,
      txHash,
      blockNumber,
      gasUsed,
      msg: `TX confirmed: ${txHash} in block ${blockNumber}`,
    });
  },

  /**
   * Log RabbitMQ event
   */
  mqEvent(
    logger: ServiceLogger,
    event: 'connected' | 'disconnected' | 'published' | 'consumed' | 'acked' | 'nacked' | 'received',
    queue?: string,
    metadata?: Record<string, unknown>
  ): void {
    logger.info({
      event,
      queue,
      ...metadata,
      msg: `MQ ${event}${queue ? ` on ${queue}` : ''}`,
    });
  },

  /**
   * Log order execution lifecycle
   */
  orderExecution(
    logger: ServiceLogger,
    orderId: string,
    phase: 'signing' | 'broadcasting' | 'waiting' | 'completed' | 'failed',
    metadata?: Record<string, unknown>
  ): void {
    const level = phase === 'failed' ? 'error' : 'info';
    logger[level]({
      orderId,
      phase,
      ...metadata,
      msg: `Order ${orderId} execution: ${phase}`,
    });
  },

  /**
   * Log hedge vault trigger
   */
  hedgeVaultTriggered(
    logger: ServiceLogger,
    vaultId: string,
    vaultAddress: string,
    poolAddress: string,
    triggerType: 'sil' | 'tip' | 'reopen',
    currentSqrtPriceX96: string
  ): void {
    logger.info({
      vaultId,
      vaultAddress,
      poolAddress,
      triggerType,
      currentSqrtPriceX96,
      msg: `Hedge vault ${vaultId} ${triggerType.toUpperCase()} triggered`,
    });
  },

  /**
   * Log hedge vault execution lifecycle
   */
  hedgeVaultExecution(
    logger: ServiceLogger,
    vaultId: string,
    triggerType: 'sil' | 'tip' | 'reopen',
    phase: 'signing' | 'broadcasting' | 'waiting' | 'completed' | 'failed',
    metadata?: Record<string, unknown>
  ): void {
    const level = phase === 'failed' ? 'error' : 'info';
    logger[level]({
      vaultId,
      triggerType,
      phase,
      ...metadata,
      msg: `Hedge vault ${vaultId} ${triggerType.toUpperCase()} execution: ${phase}`,
    });
  },
};

/**
 * Re-export service logger type for convenience
 */
export type { ServiceLogger };
