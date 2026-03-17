/**
 * Base Logger Configuration
 *
 * Pino logger setup with environment-based configuration for midcurve-services.
 * Provides structured JSON logging suitable for production environments.
 *
 * In development mode, logs are written to both stdout and a local dev.log file
 * via pino.multistream() for offline analysis.
 */

import fs from 'node:fs';
import path from 'node:path';
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
 * Walk up from cwd to find the monorepo root (has "private": true and workspaces in package.json).
 * Falls back to cwd if not found.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      if (pkg['private'] === true && pkg['workspaces']) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Build the pino destination.
 *
 * In development: multistream to stdout + logs/dev.log (append mode).
 * In production/test: stdout only.
 */
function buildDestination(): pino.DestinationStream {
  if (NODE_ENV !== 'development') {
    return process.stdout;
  }

  const repoRoot = findRepoRoot();
  const logsDir = path.join(repoRoot, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFilePath = path.join(logsDir, 'dev.log');
  const fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });

  return pino.multistream([
    { stream: process.stdout },
    { stream: fileStream },
  ]);
}

/**
 * Create and export base logger instance
 *
 * This is a singleton instance used throughout the application.
 * Service-specific loggers should be created via createServiceLogger()
 * in logger-factory.ts
 */
export const logger = pino(loggerConfig, buildDestination());

/**
 * Logger type export
 */
export type Logger = typeof logger;

/**
 * Export configuration values for reference
 */
export { LOG_LEVEL, NODE_ENV };
