import pino from 'pino';

/**
 * Create a logger instance with the given name
 */
export function createLogger(name: string): pino.Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  });
}

/**
 * Log levels matching Solidity LoggingLib
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Convert numeric log level to pino method
 */
export function getLogMethod(
  logger: pino.Logger,
  level: LogLevel
): pino.LogFn {
  switch (level) {
    case LogLevel.DEBUG:
      return logger.debug.bind(logger);
    case LogLevel.INFO:
      return logger.info.bind(logger);
    case LogLevel.WARN:
      return logger.warn.bind(logger);
    case LogLevel.ERROR:
      return logger.error.bind(logger);
    default:
      return logger.info.bind(logger);
  }
}
