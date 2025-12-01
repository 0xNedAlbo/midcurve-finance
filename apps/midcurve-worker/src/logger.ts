/**
 * Worker Logger
 *
 * Structured logging for the strategy worker process.
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  name: 'midcurve-worker',
  level,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with a specific component name
 */
export function createLogger(component: string): pino.Logger {
  return logger.child({ component });
}

/**
 * Structured log helpers for common worker events
 */
export const workerLog = {
  startup: (log: pino.Logger, activeStrategies: number) => {
    log.info({ activeStrategies, msg: 'Worker started' });
  },

  shutdown: (log: pino.Logger, reason: string) => {
    log.info({ reason, msg: 'Worker shutting down' });
  },

  strategyLoaded: (log: pino.Logger, strategyId: string, strategyType: string) => {
    log.info({ strategyId, strategyType, msg: 'Strategy loaded' });
  },

  strategyUnloaded: (log: pino.Logger, strategyId: string) => {
    log.info({ strategyId, msg: 'Strategy unloaded' });
  },

  eventReceived: (
    log: pino.Logger,
    strategyId: string,
    eventType: string,
    eventId?: string
  ) => {
    log.debug({ strategyId, eventType, eventId, msg: 'Event received' });
  },

  eventProcessed: (
    log: pino.Logger,
    strategyId: string,
    eventType: string,
    durationMs: number,
    success: boolean,
    error?: string
  ) => {
    if (success) {
      log.debug({ strategyId, eventType, durationMs, msg: 'Event processed' });
    } else {
      log.error({ strategyId, eventType, durationMs, error, msg: 'Event processing failed' });
    }
  },

  effectStarted: (
    log: pino.Logger,
    strategyId: string,
    effectId: string,
    effectType: string
  ) => {
    log.info({ strategyId, effectId, effectType, msg: 'Effect started' });
  },

  effectCompleted: (
    log: pino.Logger,
    strategyId: string,
    effectId: string,
    effectType: string,
    success: boolean,
    durationMs: number,
    error?: string
  ) => {
    if (success) {
      log.info({ strategyId, effectId, effectType, durationMs, msg: 'Effect completed' });
    } else {
      log.error({ strategyId, effectId, effectType, durationMs, error, msg: 'Effect failed' });
    }
  },

  marketDataConnected: (log: pino.Logger, source: string) => {
    log.info({ source, msg: 'Market data connected' });
  },

  marketDataDisconnected: (log: pino.Logger, source: string, reason?: string) => {
    log.warn({ source, reason, msg: 'Market data disconnected' });
  },

  healthCheck: (log: pino.Logger, healthy: boolean, activeStrategies: number) => {
    log.debug({ healthy, activeStrategies, msg: 'Health check' });
  },
};
