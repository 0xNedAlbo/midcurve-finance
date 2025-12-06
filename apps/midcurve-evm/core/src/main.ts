/**
 * SEMSEE Node - Main Entry Point
 *
 * Standalone daemon that runs the SEMSEE Core Orchestrator with:
 * - Embedded EVM connection (Geth via Docker)
 * - Hyperliquid WebSocket feed for OHLC data
 * - Strategy execution and event routing
 * - Mock effect execution (real execution coming later)
 */

// IMPORTANT: This must be the first import to set up WebSocket polyfill
// before any other modules (like Hyperliquid SDK) try to use it.
import './setup-websocket.js';

import { CoreOrchestrator } from './orchestrator/orchestrator.js';
import { HyperliquidFeed } from './datasources/hyperliquid-feed.js';
import { createLogger } from './utils/logger.js';
import { TIMEFRAME_TO_INTERVAL } from './datasources/types.js';
import type { Subscription } from './subscriptions/types.js';
import { SUBSCRIPTION_TYPES } from './events/types.js';
import { decodeAbiParameters } from 'viem';
import { getMarketInfo, computeMarketId } from './utils/market-registry.js';

const logger = createLogger('semsee-node');

/**
 * SEMSEE Node configuration from environment variables
 */
interface SemseeConfig {
  /** Geth RPC URL */
  rpcUrl: string;

  /** Geth WebSocket URL */
  wsUrl: string;

  /** Use Hyperliquid testnet */
  hyperliquidTestnet: boolean;

  /** Log level */
  logLevel: string;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): SemseeConfig {
  return {
    rpcUrl: process.env.SEMSEE_RPC_URL ?? 'http://localhost:8545',
    wsUrl: process.env.SEMSEE_WS_URL ?? 'ws://localhost:8546',
    hyperliquidTestnet: process.env.HYPERLIQUID_TESTNET === 'true',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}

/**
 * Handle new subscription from a strategy
 * Activates the appropriate data source
 */
async function handleSubscription(
  subscription: Subscription,
  hyperliquidFeed: HyperliquidFeed
): Promise<void> {
  const { subscriptionType, payload, strategyAddress } = subscription;

  switch (subscriptionType) {
    case SUBSCRIPTION_TYPES.OHLC: {
      // Decode OHLC subscription payload: abi.encode(marketId, timeframe)
      try {
        const [marketId, timeframe] = decodeAbiParameters(
          [
            { name: 'marketId', type: 'bytes32' },
            { name: 'timeframe', type: 'uint8' },
          ],
          payload
        );

        // Look up market info from registry
        const marketInfo = getMarketInfo(marketId as string);

        if (!marketInfo) {
          logger.error(
            {
              strategy: strategyAddress,
              marketId,
              timeframe: Number(timeframe),
              expectedEthUsdMarketId: computeMarketId('ETH', 'USD'),
            },
            'Unknown market ID - cannot activate subscription. Market is not registered in market-registry.ts.'
          );
          // TODO: Send error response back to strategy
          return;
        }

        const { base } = marketInfo;
        const tf = Number(timeframe);

        if (!TIMEFRAME_TO_INTERVAL[tf]) {
          logger.error(
            {
              strategy: strategyAddress,
              symbol: base,
              timeframe: tf,
              supportedTimeframes: Object.keys(TIMEFRAME_TO_INTERVAL),
            },
            'Unsupported timeframe - cannot activate subscription'
          );
          // TODO: Send error response back to strategy
          return;
        }

        await hyperliquidFeed.subscribeMarket(base, tf);
        logger.info(
          {
            strategy: strategyAddress,
            symbol: base,
            timeframe: tf,
            marketId,
          },
          'Activated OHLC subscription'
        );
      } catch (error) {
        // Determine if this is a decode error or a subscription error
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isDecodeError = errorMessage.includes('decode') || errorMessage.includes('ABI');

        logger.error(
          {
            error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
            payload,
            strategy: strategyAddress,
          },
          isDecodeError
            ? 'Failed to decode OHLC subscription payload'
            : 'Failed to activate OHLC subscription (data source error)'
        );
      }
      break;
    }

    case SUBSCRIPTION_TYPES.POOL:
    case SUBSCRIPTION_TYPES.POSITION:
    case SUBSCRIPTION_TYPES.BALANCE:
      // These data sources are not implemented yet
      logger.warn(
        { subscriptionType, strategy: strategyAddress },
        'Subscription type not yet supported - subscription will not be activated'
      );
      break;

    default:
      logger.warn(
        { subscriptionType, strategy: strategyAddress },
        'Unknown subscription type - subscription will not be activated'
      );
  }
}


/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info('Starting SEMSEE Node...');

  // Load configuration
  const config = loadConfig();
  logger.info(
    {
      rpcUrl: config.rpcUrl,
      wsUrl: config.wsUrl,
      hyperliquidTestnet: config.hyperliquidTestnet,
    },
    'Configuration loaded'
  );

  // Create orchestrator
  const orchestrator = new CoreOrchestrator({
    rpcUrl: config.rpcUrl,
    wsUrl: config.wsUrl,
  });

  // Create Hyperliquid feed
  const hyperliquidFeed = new HyperliquidFeed(logger, {
    testnet: config.hyperliquidTestnet,
  });

  // Connect feed to orchestrator
  hyperliquidFeed.setOrchestrator(orchestrator);

  // Wire subscription manager to data sources
  const subscriptionManager = orchestrator.getSubscriptionManager();
  subscriptionManager.setOnSubscriptionAdded(async (subscription) => {
    await handleSubscription(subscription, hyperliquidFeed);
  });

  // Start Hyperliquid feed FIRST (must be connected before orchestrator scans for strategies)
  // The orchestrator initialization scans for existing running strategies, which may
  // trigger subscriptions immediately. WebSocket must be ready before that happens.
  logger.info('Starting Hyperliquid feed...');
  try {
    await hyperliquidFeed.start();
    logger.info('Hyperliquid feed started');
  } catch (error) {
    logger.error({ error }, 'Failed to start Hyperliquid feed');
    // Continue without Hyperliquid - other data sources may work
  }

  // Initialize orchestrator (connects to Geth, scans for running strategies)
  logger.info('Initializing orchestrator...');
  try {
    await orchestrator.initialize();
    logger.info('Orchestrator initialized');
  } catch (error) {
    logger.error(
      { error },
      'Failed to initialize orchestrator. Is Geth running?'
    );
    process.exit(1);
  }

  logger.info('SEMSEE Node running');

  // Log periodic stats
  const statsInterval = setInterval(() => {
    const mailboxStats = orchestrator.getMailboxStats();
    const subscriptionCount = hyperliquidFeed.subscriptionCount;

    if (mailboxStats.totalPending > 0 || subscriptionCount > 0) {
      logger.info(
        {
          pendingEvents: mailboxStats.totalPending,
          activeSubscriptions: subscriptionCount,
        },
        'Node stats'
      );
    }
  }, 60000); // Every minute

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');

    clearInterval(statsInterval);

    // Stop Hyperliquid feed
    logger.info('Stopping Hyperliquid feed...');
    await hyperliquidFeed.stop();

    // Shutdown orchestrator
    logger.info('Shutting down orchestrator...');
    await orchestrator.shutdown();

    logger.info('SEMSEE Node shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

// Run main
main().catch((error) => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});
