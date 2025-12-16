/**
 * Logger for midcurve-evm
 *
 * Uses pino for structured JSON logging.
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
          },
        }
      : undefined,
});

/**
 * Logging helpers for consistent method entry/exit logging
 */
export const evmLog = {
  methodEntry: (
    log: pino.Logger,
    method: string,
    params?: Record<string, unknown>
  ) => {
    log.debug({ method, ...params }, `→ ${method}`);
  },

  methodExit: (
    log: pino.Logger,
    method: string,
    result?: Record<string, unknown>
  ) => {
    log.debug({ method, ...result }, `← ${method}`);
  },

  methodError: (
    log: pino.Logger,
    method: string,
    error: unknown,
    context?: Record<string, unknown>
  ) => {
    log.error(
      { method, error: error instanceof Error ? error.message : error, ...context },
      `✗ ${method}`
    );
  },
};
