/**
 * Signer API Logging Utilities
 *
 * Provides structured logging for the signing API using Pino from @midcurve/services.
 */

import { createServiceLogger, LogPatterns } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';
import type { NextRequest } from 'next/server';

/**
 * Base Signer API logger instance
 */
export const signerLogger = createServiceLogger('MidcurveSigner');

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
 * Signer API-specific logging patterns
 */
export const signerLog = {
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
   * Log HTTP request start
   */
  requestStart(logger: ServiceLogger, requestId: string, request: NextRequest): void {
    const url = new URL(request.url);

    logger.info({
      requestId,
      method: request.method,
      path: url.pathname,
      msg: `${request.method} ${url.pathname}`,
    });
  },

  /**
   * Log HTTP request completion
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
   * Log internal auth result
   */
  internalAuth(
    logger: ServiceLogger,
    requestId: string,
    success: boolean,
    reason?: string
  ): void {
    if (success) {
      logger.info({
        requestId,
        msg: 'Internal API key validated',
      });
    } else {
      logger.warn({
        requestId,
        reason,
        msg: `Internal auth failed: ${reason}`,
      });
    }
  },

  /**
   * Log intent verification
   */
  intentVerification(
    logger: ServiceLogger,
    requestId: string,
    success: boolean,
    intentId?: string,
    reason?: string
  ): void {
    if (success) {
      logger.info({
        requestId,
        intentId,
        msg: 'Intent signature verified',
      });
    } else {
      logger.warn({
        requestId,
        intentId,
        reason,
        msg: `Intent verification failed: ${reason}`,
      });
    }
  },

  /**
   * Log signing operation
   */
  signingOperation(
    logger: ServiceLogger,
    requestId: string,
    operation: string,
    walletAddress: string,
    chainId: number,
    success: boolean,
    txHash?: string,
    errorCode?: string
  ): void {
    if (success) {
      logger.info({
        requestId,
        operation,
        walletAddress,
        chainId,
        txHash,
        msg: `Signing successful: ${operation}`,
      });
    } else {
      logger.error({
        requestId,
        operation,
        walletAddress,
        chainId,
        errorCode,
        msg: `Signing failed: ${operation} - ${errorCode}`,
      });
    }
  },

  /**
   * Log KMS operation
   */
  kmsOperation(
    logger: ServiceLogger,
    requestId: string,
    operation: 'createKey' | 'getPublicKey' | 'sign',
    success: boolean,
    keyId?: string,
    durationMs?: number,
    error?: string
  ): void {
    if (success) {
      logger.debug({
        requestId,
        operation,
        keyId,
        durationMs,
        msg: `KMS ${operation} completed`,
      });
    } else {
      logger.error({
        requestId,
        operation,
        keyId,
        error,
        msg: `KMS ${operation} failed: ${error}`,
      });
    }
  },
};

export type { ServiceLogger };
