/**
 * Next.js Instrumentation
 *
 * Automatically starts workers when the Next.js server starts.
 * Only runs on the server side, not in the browser.
 */

export async function register(): Promise<void> {
  // Only run on the server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startWorkers } = await import('./workers');
    const { automationLogger } = await import('./lib/logger');

    const log = automationLogger.child({ component: 'Instrumentation' });

    // Check if workers should auto-start (default: true)
    const autoStart = process.env.AUTO_START_WORKERS !== 'false';

    if (!autoStart) {
      log.info({ msg: 'Worker auto-start disabled' });
      return;
    }

    try {
      log.info({ msg: 'Auto-starting workers...' });
      await startWorkers();
      log.info({ msg: 'Workers auto-started successfully' });
    } catch (err) {
      log.error({ err, msg: 'Failed to auto-start workers' });
      // Don't throw - allow API to start even if workers fail
    }
  }
}
