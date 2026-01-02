/**
 * Worker Startup Script
 *
 * Standalone entry point for running automation workers.
 * Used when running workers separately from the Next.js API.
 */

import { startWorkers, stopWorkers } from '../src/workers';
import { automationLogger } from '../src/lib/logger';

const log = automationLogger.child({ component: 'WorkerScript' });

async function main(): Promise<void> {
  log.info({ msg: 'Starting automation workers...' });

  // Start all workers
  const manager = await startWorkers();

  log.info({
    msg: 'Workers started successfully',
    status: manager.getStatus(),
  });

  // Handle graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal, msg: 'Received shutdown signal' });

    try {
      await stopWorkers();
      log.info({ msg: 'Workers stopped gracefully' });
      process.exit(0);
    } catch (err) {
      log.error({ err, msg: 'Error during shutdown' });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Keep process running
  log.info({ msg: 'Workers running. Press Ctrl+C to stop.' });
}

main().catch((err) => {
  log.error({ err, msg: 'Failed to start workers' });
  process.exit(1);
});
