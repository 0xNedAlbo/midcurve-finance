/**
 * Logger Factory
 *
 * Creates service-specific Pino child loggers with consistent patterns.
 * Provides utility functions for common logging scenarios.
 */

import pino from 'pino';
import { logger as baseLogger } from './logger.js';

/**
 * Service logger interface
 * Extends Pino logger with service-specific context
 */
export interface ServiceLogger extends pino.Logger {
  // Extend with custom methods if needed in future
}

/**
 * Create a service-specific logger with structured context
 *
 * @param serviceName - Name of the service (e.g., 'CoinGeckoClient', 'TokenService')
 * @returns Service logger with service context
 *
 * @example
 * ```typescript
 * const logger = createServiceLogger('CoinGeckoClient');
 * logger.info('Fetching tokens from API');
 * // Output: {"level":"info","service":"CoinGeckoClient","msg":"Fetching tokens from API"}
 * ```
 */
export function createServiceLogger(serviceName: string): ServiceLogger {
  return baseLogger.child({
    service: serviceName,
  }) as ServiceLogger;
}

/**
 * Common logging patterns for services
 *
 * Provides consistent logging structure across all services.
 * Use these patterns to maintain uniform log format.
 */
export const LogPatterns = {
  /**
   * Log service method entry (debug level)
   *
   * @param logger - Service logger instance
   * @param method - Method name
   * @param params - Method parameters (will be serialized)
   *
   * @example
   * ```typescript
   * LogPatterns.methodEntry(logger, 'getAllTokens', { useCache: true });
   * // Output: {"level":"debug","service":"...","method":"getAllTokens","params":{"useCache":true},"msg":"Entering getAllTokens"}
   * ```
   */
  methodEntry: (
    logger: ServiceLogger,
    method: string,
    params: Record<string, unknown> = {}
  ) => {
    logger.debug({ method, params }, `Entering ${method}`);
  },

  /**
   * Log service method exit (debug level)
   *
   * @param logger - Service logger instance
   * @param method - Method name
   * @param result - Optional result summary (avoid logging large objects)
   *
   * @example
   * ```typescript
   * LogPatterns.methodExit(logger, 'getAllTokens', { count: 1500 });
   * // Output: {"level":"debug","service":"...","method":"getAllTokens","result":{"count":1500},"msg":"Exiting getAllTokens"}
   * ```
   */
  methodExit: (
    logger: ServiceLogger,
    method: string,
    result?: Record<string, unknown>
  ) => {
    logger.debug({ method, result }, `Exiting ${method}`);
  },

  /**
   * Log service method error (error level)
   *
   * @param logger - Service logger instance
   * @param method - Method name where error occurred
   * @param error - Error object
   * @param context - Additional context about the error
   *
   * @example
   * ```typescript
   * LogPatterns.methodError(logger, 'getCoinDetails', error, { coinId: 'bitcoin' });
   * // Output: {"level":"error","service":"...","method":"getCoinDetails","error":"API error","stack":"...","coinId":"bitcoin","msg":"Error in getCoinDetails"}
   * ```
   */
  methodError: (
    logger: ServiceLogger,
    method: string,
    error: Error,
    context: Record<string, unknown> = {}
  ) => {
    logger.error(
      {
        method,
        error: error.message,
        errorName: error.name,
        stack: error.stack,
        ...context,
      },
      `Error in ${method}`
    );
  },

  /**
   * Log external API call (debug level)
   *
   * @param logger - Service logger instance
   * @param api - API name (e.g., 'CoinGecko', 'Ethereum RPC')
   * @param endpoint - API endpoint or method
   * @param params - Request parameters
   *
   * @example
   * ```typescript
   * LogPatterns.externalApiCall(logger, 'CoinGecko', '/coins/list', { include_platform: true });
   * // Output: {"level":"debug","service":"...","api":"CoinGecko","endpoint":"/coins/list","params":{"include_platform":true},"msg":"External API call"}
   * ```
   */
  externalApiCall: (
    logger: ServiceLogger,
    api: string,
    endpoint: string,
    params: Record<string, unknown> = {}
  ) => {
    logger.debug({ api, endpoint, params }, `External API call: ${api}`);
  },

  /**
   * Log cache hit (debug level)
   *
   * @param logger - Service logger instance
   * @param method - Method name
   * @param cacheKey - Optional cache key identifier
   *
   * @example
   * ```typescript
   * LogPatterns.cacheHit(logger, 'getAllTokens', 'tokens');
   * // Output: {"level":"debug","service":"...","method":"getAllTokens","cacheKey":"tokens","msg":"Cache hit"}
   * ```
   */
  cacheHit: (
    logger: ServiceLogger,
    method: string,
    cacheKey?: string
  ) => {
    logger.debug({ method, cacheKey }, `Cache hit`);
  },

  /**
   * Log cache miss (debug level)
   *
   * @param logger - Service logger instance
   * @param method - Method name
   * @param cacheKey - Optional cache key identifier
   *
   * @example
   * ```typescript
   * LogPatterns.cacheMiss(logger, 'getAllTokens', 'tokens');
   * // Output: {"level":"debug","service":"...","method":"getAllTokens","cacheKey":"tokens","msg":"Cache miss"}
   * ```
   */
  cacheMiss: (
    logger: ServiceLogger,
    method: string,
    cacheKey?: string
  ) => {
    logger.debug({ method, cacheKey }, `Cache miss`);
  },

  /**
   * Log database operation (debug level)
   *
   * @param logger - Service logger instance
   * @param operation - Database operation (e.g., 'create', 'findFirst', 'update', 'delete')
   * @param table - Database table name
   * @param params - Query parameters or conditions
   *
   * @example
   * ```typescript
   * LogPatterns.dbOperation(logger, 'create', 'Token', { symbol: 'USDC' });
   * // Output: {"level":"debug","service":"...","operation":"create","table":"Token","params":{"symbol":"USDC"},"msg":"Database operation: create on Token"}
   * ```
   */
  dbOperation: (
    logger: ServiceLogger,
    operation: string,
    table: string,
    params: Record<string, unknown> = {}
  ) => {
    logger.debug(
      { operation, table, params },
      `Database operation: ${operation} on ${table}`
    );
  },
};

/**
 * Alias for LogPatterns for more concise usage
 *
 * @example
 * ```typescript
 * import { log } from '@midcurve/services';
 *
 * log.methodEntry(logger, 'myMethod', { param: 'value' });
 * log.methodExit(logger, 'myMethod');
 * ```
 */
export const log = LogPatterns;
