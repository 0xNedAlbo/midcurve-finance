/**
 * API Logging Utilities
 *
 * Provides structured logging for API routes using Pino from @midcurve/services.
 * Includes API-specific logging patterns for requests, authentication, and errors.
 *
 * Usage:
 * ```typescript
 * import { apiLogger, apiLog } from '@/lib/logger';
 *
 * export async function GET(request: NextRequest) {
 *   const requestId = nanoid();
 *   apiLog.requestStart(apiLogger, requestId, request);
 *
 *   try {
 *     // ... handler logic
 *     apiLog.requestEnd(apiLogger, requestId, 200, Date.now() - start);
 *   } catch (error) {
 *     apiLog.methodError(apiLogger, 'GET /api/v1/users', error);
 *   }
 * }
 * ```
 */

import { createServiceLogger, LogPatterns } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';
import type { NextRequest } from 'next/server';

/**
 * Base API logger instance
 */
export const apiLogger = createServiceLogger('MidcurveAPI');

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
 * API-specific logging patterns
 */
export const apiLog = {
  /**
   * Re-export service patterns (for database operations, cache, etc.)
   */
  dbOperation: LogPatterns.dbOperation,
  cacheHit: LogPatterns.cacheHit,
  cacheMiss: LogPatterns.cacheMiss,
  externalApiCall: LogPatterns.externalApiCall,
  methodEntry: LogPatterns.methodEntry,
  methodExit: LogPatterns.methodExit,

  /**
   * Log method error (wraps LogPatterns.methodError with unknown error handling)
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
   * Log HTTP request start
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param request - Next.js request object
   */
  requestStart(logger: ServiceLogger, requestId: string, request: NextRequest): void {
    const url = new URL(request.url);
    const headers = sanitizeHeaders(request.headers);

    logger.info({
      requestId,
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      msg: `${request.method} ${url.pathname}`,
    });
  },

  /**
   * Log HTTP request completion
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param statusCode - HTTP status code
   * @param durationMs - Request duration in milliseconds
   */
  requestEnd(
    logger: ServiceLogger,
    requestId: string,
    statusCode: number,
    durationMs: number
  ): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      requestId,
      statusCode,
      durationMs,
      msg: `Request completed - ${statusCode} (${durationMs}ms)`,
    });
  },

  /**
   * Log successful authentication
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param userId - Authenticated user ID
   * @param authMethod - Authentication method used
   * @param apiKeyPrefix - API key prefix (if using API key auth)
   */
  authSuccess(
    logger: ServiceLogger,
    requestId: string,
    userId: string,
    authMethod: 'session' | 'api_key',
    apiKeyPrefix?: string
  ): void {
    logger.info({
      requestId,
      userId,
      authMethod,
      apiKeyPrefix,
      msg: `Authentication successful via ${authMethod}`,
    });
  },

  /**
   * Log failed authentication attempt
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param reason - Failure reason
   * @param authMethod - Authentication method attempted
   */
  authFailure(
    logger: ServiceLogger,
    requestId: string,
    reason: string,
    authMethod?: 'session' | 'api_key' | 'ui_jwt'
  ): void {
    logger.warn({
      requestId,
      authMethod,
      reason,
      msg: `Authentication failed: ${reason}`,
    });
  },

  /**
   * Log validation errors
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param errors - Validation error details
   */
  validationError(logger: ServiceLogger, requestId: string, errors: unknown): void {
    logger.warn({
      requestId,
      errors,
      msg: 'Request validation failed',
    });
  },

  /**
   * Log business operation (token created, wallet linked, etc.)
   *
   * @param logger - Logger instance
   * @param requestId - Unique request identifier
   * @param operation - Operation name
   * @param resourceType - Type of resource (token, wallet, etc.)
   * @param resourceId - Resource identifier
   * @param metadata - Additional metadata
   */
  businessOperation(
    logger: ServiceLogger,
    requestId: string,
    operation: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>
  ): void {
    logger.info({
      requestId,
      operation,
      resourceType,
      resourceId,
      ...metadata,
      msg: `${operation} ${resourceType}: ${resourceId}`,
    });
  },
};

/**
 * Sanitize HTTP headers to remove sensitive information
 *
 * @param headers - Request headers
 * @returns Sanitized headers object
 */
function sanitizeHeaders(headers: Headers): Record<string, string> {
  const sanitized: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();

    // Redact sensitive headers
    if (
      lowerKey === 'authorization' ||
      lowerKey === 'cookie' ||
      lowerKey === 'x-api-key' ||
      lowerKey === 'set-cookie'
    ) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
}

/**
 * Re-export service logger type for convenience
 */
export type { ServiceLogger };
