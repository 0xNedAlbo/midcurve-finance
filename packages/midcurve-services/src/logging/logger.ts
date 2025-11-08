/**
 * Base Logger Configuration
 *
 * Pino logger setup with environment-based configuration for midcurve-services.
 * Provides structured JSON logging suitable for production environments.
 */

import pino from 'pino';

/**
 * Log level mapping by environment
 */
const LOG_LEVELS = {
  development: 'debug',
  production: 'info',
  test: 'silent',
} as const;

/**
 * Get environment variables with defaults
 */
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL =
  process.env.LOG_LEVEL ||
  LOG_LEVELS[NODE_ENV as keyof typeof LOG_LEVELS] ||
  'info';

/**
 * Base logger configuration
 */
const loggerConfig: pino.LoggerOptions = {
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

/**
 * Create and export base logger instance
 *
 * This is a singleton instance used throughout the application.
 * Service-specific loggers should be created via createServiceLogger()
 * in logger-factory.ts
 */
export const logger = pino(loggerConfig);

/**
 * Logger type export
 */
export type Logger = typeof logger;

/**
 * Export configuration values for reference
 */
export { LOG_LEVEL, NODE_ENV };
