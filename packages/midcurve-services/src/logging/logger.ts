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
 *
 * The level is deliberately absent here: createLogger() owns it, so that the
 * logger's level and the per-destination levels are set from one value in one
 * place. See buildDevStreams() for why that matters.
 */
const loggerConfig: pino.LoggerOptions = {
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
 * Open logs/dev.log for appending, creating the logs directory if needed.
 *
 * Only called on the development branch of createLogger().
 */
function openDevLogFile(): pino.DestinationStream {
  const repoRoot = findRepoRoot();
  const logsDir = path.join(repoRoot, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const logFilePath = path.join(logsDir, 'dev.log');
  return fs.createWriteStream(logFilePath, { flags: 'a' });
}

/**
 * Build the development stream entries: stdout + logs/dev.log.
 */
function buildDevStreams(
  stdout: pino.DestinationStream,
  file: pino.DestinationStream
): pino.StreamEntry[] {
  return [{ stream: stdout }, { stream: file }];
}

/**
 * Options for createLogger().
 *
 * Every input the logger depends on is passed in rather than read from the
 * environment, so the wiring can be exercised by a test. See #94: the previous
 * shape could only be tested by rebuilding a multistream in the test, which
 * exercises pino rather than this module.
 */
export interface CreateLoggerOptions {
  nodeEnv: string;
  logLevel: string;
  stdout: pino.DestinationStream;
  openLogFile: () => pino.DestinationStream;
}

/**
 * Build a logger.
 *
 * In development: multistream to stdout + logs/dev.log (append mode).
 * In production/test: stdout only.
 *
 * Exported for the test in logger.test.ts, and deliberately not re-exported
 * from ./index.ts or the package barrel — there is one logger per process and
 * this is not a second way to get one.
 */
export function createLogger(opts: CreateLoggerOptions): pino.Logger {
  const config: pino.LoggerOptions = { ...loggerConfig, level: opts.logLevel };

  if (opts.nodeEnv !== 'development') {
    return pino(config, opts.stdout);
  }

  return pino(
    config,
    pino.multistream(buildDevStreams(opts.stdout, opts.openLogFile()))
  );
}

/**
 * Create and export base logger instance
 *
 * This is a singleton instance used throughout the application.
 * Service-specific loggers should be created via createServiceLogger()
 * in logger-factory.ts
 */
export const logger = createLogger({
  nodeEnv: NODE_ENV,
  logLevel: LOG_LEVEL,
  stdout: process.stdout,
  openLogFile: openDevLogFile,
});

/**
 * Logger type export
 */
export type Logger = typeof logger;

/**
 * Export configuration values for reference
 */
export { LOG_LEVEL, NODE_ENV };
