/**
 * Business Logic Worker Entry Point
 *
 * Starts the RuleManager and handles graceful shutdown on SIGINT/SIGTERM.
 */

import { businessLogicLogger } from './lib/logger';
import { RuleManager } from './workers';

const log = businessLogicLogger.child({ component: 'Main' });

// Global rule manager instance
let ruleManager: RuleManager | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    log.warn({ signal, msg: 'Shutdown already in progress, ignoring signal' });
    return;
  }

  isShuttingDown = true;
  log.info({ signal, msg: 'Received shutdown signal, stopping rules...' });

  try {
    if (ruleManager) {
      await ruleManager.stop();
    }

    log.info({ msg: 'Shutdown complete' });
    process.exit(0);
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      msg: 'Error during shutdown',
    });
    process.exit(1);
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  log.info({ msg: 'Starting Midcurve Business Logic Worker...' });

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    log.error({ error: error.message, stack: error.stack, msg: 'Uncaught exception' });
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error({ error: error.message, stack: error.stack, msg: 'Unhandled rejection' });
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });

  try {
    // Create and start rule manager
    ruleManager = new RuleManager();
    await ruleManager.start();

    // Log status
    const status = ruleManager.getStatus();
    log.info({
      ruleCount: status.rules.length,
      runningRules: status.rules.filter((r) => r.isRunning).length,
      rabbitmqConnected: status.rabbitmq.isConnected,
      msg: 'Worker started successfully',
    });
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to start worker',
    });
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  log.error({
    error: error instanceof Error ? error.message : String(error),
    msg: 'Unexpected error in main',
  });
  process.exit(1);
});
