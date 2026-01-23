/**
 * Pool Prices Worker Entry Point
 *
 * Starts the WorkerManager and handles graceful shutdown on SIGINT/SIGTERM.
 */

import { poolPricesLogger } from './lib/logger';
import { WorkerManager } from './workers';

const log = poolPricesLogger.child({ component: 'Main' });

// Global worker manager instance
let workerManager: WorkerManager | null = null;
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
  log.info({ signal, msg: 'Received shutdown signal, stopping workers...' });

  try {
    if (workerManager) {
      await workerManager.stop();
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
  log.info({ msg: 'Starting Midcurve Pool Prices Worker...' });

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
    // Create and start worker manager
    workerManager = new WorkerManager();
    await workerManager.start();

    // Log status
    const status = workerManager.getStatus();
    log.info({
      subscriberBatches: status.subscriber.batchCount,
      totalPools: status.subscriber.batches.reduce((sum, b) => sum + b.poolCount, 0),
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
