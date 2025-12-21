/**
 * Logger for midcurve-evm
 *
 * Uses pino for structured JSON logging.
 *
 * Note: pino-pretty transport is disabled because it uses worker threads
 * which don't work correctly with Next.js's bundler. For pretty logging
 * in development, pipe output to pino-pretty:
 *   npm run dev | npx pino-pretty
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
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
