/**
 * Midcurve Strategy Worker
 *
 * Long-running background process that:
 * - Loads active strategies from database
 * - Processes strategy events (OHLC, position, action, effect)
 * - Executes strategy logic for each strategy
 * - Coordinates effects (swaps, liquidity changes, hedges)
 *
 * Deployment: ECS Fargate task
 */

import 'dotenv/config';
import { createServer } from 'http';
import { prisma } from '@midcurve/database';
import { logger, workerLog, createLogger } from './logger.js';
import { loadConfig, validateConfig } from './config.js';
import { RuntimeManager } from './runtime/index.js';
import { ActionPoller } from './providers/index.js';

const mainLogger = createLogger('main');

/**
 * Graceful shutdown handler
 */
async function shutdown(
  runtimeManager: RuntimeManager,
  actionPoller: ActionPoller,
  httpServer?: ReturnType<typeof createServer>
): Promise<void> {
  mainLogger.info('Shutdown signal received, gracefully shutting down...');

  // Stop accepting new events
  if (httpServer) {
    httpServer.close();
  }

  // Stop action poller
  actionPoller.stop();

  // Stop all strategy runtimes
  await runtimeManager.stopAll();

  // Close database connection
  await prisma.$disconnect();

  mainLogger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Create health check HTTP server
 */
function createHealthServer(
  runtimeManager: RuntimeManager,
  port: number
): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      const health = runtimeManager.getHealth();
      const statusCode = health.healthy ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));

      workerLog.healthCheck(mainLogger, health.healthy, health.activeStrategies);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    mainLogger.info({ port }, 'Health check server listening');
  });

  return server;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  mainLogger.info('Starting Midcurve Strategy Worker...');

  // Load and validate configuration
  const config = loadConfig();
  validateConfig(config);

  mainLogger.info(
    {
      nodeEnv: config.nodeEnv,
      chains: Object.keys(config.rpcUrls),
      healthCheckPort: config.healthCheckPort,
    },
    'Configuration loaded'
  );

  // Database is already connected via the singleton
  mainLogger.info('Using database singleton');

  // Initialize runtime manager
  const runtimeManager = new RuntimeManager(prisma, config);

  // Load active strategies
  await runtimeManager.loadActiveStrategies();

  // Initialize and start action poller
  const actionPoller = new ActionPoller(
    prisma,
    runtimeManager,
    config.actionPollIntervalMs
  );
  actionPoller.start();

  // Start health check server (if port > 0)
  let httpServer: ReturnType<typeof createServer> | undefined;
  if (config.healthCheckPort > 0) {
    httpServer = createHealthServer(runtimeManager, config.healthCheckPort);
  }

  // Set up signal handlers
  process.on('SIGTERM', () => shutdown(runtimeManager, actionPoller, httpServer));
  process.on('SIGINT', () => shutdown(runtimeManager, actionPoller, httpServer));

  // Log startup complete
  mainLogger.info(
    {
      activeStrategies: runtimeManager.getActiveCount(),
      actionPollIntervalMs: config.actionPollIntervalMs,
      nodeEnv: config.nodeEnv,
    },
    'Worker startup complete'
  );

  // Keep the process running with heartbeat logging
  setInterval(() => {
    const health = runtimeManager.getHealth();
    mainLogger.debug(
      {
        activeStrategies: health.activeStrategies,
        pendingEvents: health.pendingEvents,
      },
      'Worker heartbeat'
    );
  }, 60000); // Log every minute
}

// Run
main().catch((error) => {
  logger.error({ error }, 'Worker failed to start');
  process.exit(1);
});
