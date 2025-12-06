/**
 * Strategy Event Watcher
 *
 * Watches for strategy lifecycle events (StrategyStarted, StrategyShutdown)
 * emitted by any address on the chain. When detected, fetches the full
 * transaction receipt to process all logs from that transaction.
 *
 * This enables the orchestrator to detect and process subscription events
 * from strategies that are started via CLI or other external callers.
 */

import type { Address, Log, PublicClient, WatchEventReturnType } from 'viem';
import type pino from 'pino';
import { EVENT_TOPICS, STRATEGY_LIFECYCLE_ABI, StrategyState } from '../events/types.js';

export interface StrategyWatcherConfig {
  publicClient: PublicClient;
  logger: pino.Logger;
  onStrategyStarted: (strategyAddress: Address, logs: Log[], txHash?: string) => Promise<void>;
  onStrategyShutdown: (strategyAddress: Address, logs: Log[], txHash?: string) => Promise<void>;
}

export class StrategyWatcher {
  private logger: pino.Logger;
  private publicClient: PublicClient;
  private onStrategyStarted: StrategyWatcherConfig['onStrategyStarted'];
  private onStrategyShutdown: StrategyWatcherConfig['onStrategyShutdown'];
  private unwatch: WatchEventReturnType | null = null;

  constructor(config: StrategyWatcherConfig) {
    this.logger = config.logger;
    this.publicClient = config.publicClient;
    this.onStrategyStarted = config.onStrategyStarted;
    this.onStrategyShutdown = config.onStrategyShutdown;
  }

  /**
   * Start watching for strategy lifecycle events
   */
  async start(): Promise<void> {
    this.logger.info('Starting strategy watcher...');

    // Watch for both StrategyStarted and StrategyShutdown events
    // from ANY address (no address filter)
    this.unwatch = this.publicClient.watchEvent({
      events: STRATEGY_LIFECYCLE_ABI.filter((item) => item.type === 'event'),
      onLogs: async (logs) => {
        for (const log of logs) {
          await this.handleStrategyEvent(log);
        }
      },
      onError: (error) => {
        this.logger.error({ error }, 'Strategy watcher error');
      },
    });

    this.logger.info('Strategy watcher started');
  }

  /**
   * Handle a strategy lifecycle event
   */
  private async handleStrategyEvent(log: Log): Promise<void> {
    const strategyAddress = log.address;
    const txHash = log.transactionHash;
    const eventTopic = log.topics[0];

    if (!txHash) {
      this.logger.warn({ log }, 'Log missing transaction hash');
      return;
    }

    this.logger.info(
      {
        strategy: strategyAddress,
        txHash,
        topic: eventTopic,
      },
      'Strategy lifecycle event detected'
    );

    try {
      // Fetch full transaction receipt to get ALL logs from this tx
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: txHash,
      });

      // Filter logs from this strategy only (important for multi-call txs)
      const strategyLogs = receipt.logs.filter(
        (l) => l.address.toLowerCase() === strategyAddress.toLowerCase()
      );

      this.logger.debug(
        {
          strategy: strategyAddress,
          totalLogs: receipt.logs.length,
          strategyLogs: strategyLogs.length,
        },
        'Transaction receipt fetched'
      );

      // Determine event type and call appropriate handler
      if (eventTopic === EVENT_TOPICS.STRATEGY_STARTED) {
        this.logger.info(
          { strategy: strategyAddress },
          'Processing StrategyStarted event'
        );
        await this.onStrategyStarted(strategyAddress, strategyLogs, txHash);
      } else if (eventTopic === EVENT_TOPICS.STRATEGY_SHUTDOWN) {
        this.logger.info(
          { strategy: strategyAddress },
          'Processing StrategyShutdown event'
        );
        await this.onStrategyShutdown(strategyAddress, strategyLogs, txHash);
      } else {
        this.logger.warn(
          { topic: eventTopic },
          'Unknown strategy event topic'
        );
      }
    } catch (error) {
      this.logger.error(
        {
          strategy: strategyAddress,
          txHash,
          error,
        },
        'Failed to process strategy event'
      );
    }
  }

  /**
   * Scan for existing running strategies (for orchestrator startup)
   *
   * @param fromBlock Block to start scanning from (default: last 1000 blocks)
   */
  async scanExistingStrategies(fromBlock?: bigint): Promise<void> {
    this.logger.info('Scanning for existing running strategies...');

    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      const startBlock =
        fromBlock ?? (currentBlock > 1000n ? currentBlock - 1000n : 0n);

      this.logger.debug(
        {
          fromBlock: startBlock.toString(),
          toBlock: currentBlock.toString(),
        },
        'Scan range'
      );

      // Get all StrategyStarted events in the range
      const startedLogs = await this.publicClient.getLogs({
        events: STRATEGY_LIFECYCLE_ABI.filter(
          (item) => item.type === 'event' && item.name === 'StrategyStarted'
        ),
        fromBlock: startBlock,
        toBlock: currentBlock,
      });

      this.logger.info(
        { count: startedLogs.length },
        'Found StrategyStarted events in history, checking current state...'
      );

      // For each, check if still running (not shutdown)
      let runningCount = 0;
      let shutdownCount = 0;
      let errorCount = 0;

      for (const log of startedLogs) {
        const strategyAddress = log.address;

        try {
          // Read strategy state
          const state = await this.publicClient.readContract({
            address: strategyAddress,
            abi: STRATEGY_LIFECYCLE_ABI,
            functionName: 'state',
          });

          if (state === StrategyState.Running) {
            runningCount++;
            this.logger.info(
              { strategy: strategyAddress },
              'Found running strategy, loading subscriptions'
            );

            // Fetch the full tx receipt to get subscription events
            if (log.transactionHash) {
              const receipt = await this.publicClient.getTransactionReceipt({
                hash: log.transactionHash,
              });

              const strategyLogs = receipt.logs.filter(
                (l) =>
                  l.address.toLowerCase() === strategyAddress.toLowerCase()
              );

              await this.onStrategyStarted(strategyAddress, strategyLogs, log.transactionHash);
            }
          } else {
            shutdownCount++;
            this.logger.debug(
              { strategy: strategyAddress, state },
              'Strategy not running, skipping'
            );
          }
        } catch (error) {
          errorCount++;
          this.logger.warn(
            { strategy: strategyAddress, error },
            'Failed to check strategy state (may not be a valid strategy)'
          );
        }
      }

      this.logger.info(
        { total: startedLogs.length, running: runningCount, shutdown: shutdownCount, errors: errorCount },
        'Strategy scan complete'
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to scan for existing strategies');
    }
  }

  /**
   * Stop watching for strategy events
   */
  async stop(): Promise<void> {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
      this.logger.info('Strategy watcher stopped');
    }
  }
}
