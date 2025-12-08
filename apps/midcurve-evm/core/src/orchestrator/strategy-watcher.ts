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

import type { Address, Log, PublicClient, WatchEventReturnType, WatchBlockNumberReturnType } from 'viem';
import type pino from 'pino';
import { EVENT_TOPICS, STRATEGY_LIFECYCLE_ABI, FUNDING_EVENTS_ABI, StrategyState } from '../events/types.js';

export interface StrategyWatcherConfig {
  publicClient: PublicClient;
  logger: pino.Logger;
  onStrategyStarted: (strategyAddress: Address, logs: Log[], txHash?: string) => Promise<void>;
  onStrategyShutdown: (strategyAddress: Address, logs: Log[], txHash?: string) => Promise<void>;
  onFundingEvent?: (strategyAddress: Address, logs: Log[], txHash?: string) => Promise<void>;
}

export class StrategyWatcher {
  private logger: pino.Logger;
  private publicClient: PublicClient;
  private onStrategyStarted: StrategyWatcherConfig['onStrategyStarted'];
  private onStrategyShutdown: StrategyWatcherConfig['onStrategyShutdown'];
  private onFundingEvent?: StrategyWatcherConfig['onFundingEvent'];
  private unwatchLifecycle: WatchEventReturnType | null = null;
  private unwatchFunding: WatchBlockNumberReturnType | null = null;
  private lastProcessedBlock: bigint = 0n;

  constructor(config: StrategyWatcherConfig) {
    this.logger = config.logger;
    this.publicClient = config.publicClient;
    this.onStrategyStarted = config.onStrategyStarted;
    this.onStrategyShutdown = config.onStrategyShutdown;
    this.onFundingEvent = config.onFundingEvent;
  }

  /**
   * Start watching for strategy lifecycle events
   */
  async start(): Promise<void> {
    this.logger.info('Starting strategy watcher...');

    // Watch for both StrategyStarted and StrategyShutdown events
    // from ANY address (no address filter)
    this.unwatchLifecycle = this.publicClient.watchEvent({
      events: STRATEGY_LIFECYCLE_ABI.filter((item) => item.type === 'event'),
      onLogs: async (logs) => {
        for (const log of logs) {
          await this.handleStrategyEvent(log);
        }
      },
      onError: (error) => {
        this.logger.error({ error }, 'Strategy lifecycle watcher error');
      },
    });

    // Watch for funding events (EthBalanceUpdateRequested) using block polling
    // This is more reliable than watchEvent with HTTP transport
    if (this.onFundingEvent) {
      // Get current block to start watching from
      this.lastProcessedBlock = await this.publicClient.getBlockNumber();
      this.logger.info({ startBlock: this.lastProcessedBlock.toString() }, 'Starting funding event watcher from block');

      this.unwatchFunding = this.publicClient.watchBlockNumber({
        onBlockNumber: async (blockNumber) => {
          if (blockNumber <= this.lastProcessedBlock) {
            return; // Already processed
          }

          try {
            // Get all funding events in the new blocks
            const logs = await this.publicClient.getLogs({
              events: FUNDING_EVENTS_ABI,
              fromBlock: this.lastProcessedBlock + 1n,
              toBlock: blockNumber,
            });

            if (logs.length > 0) {
              this.logger.info(
                { logCount: logs.length, fromBlock: (this.lastProcessedBlock + 1n).toString(), toBlock: blockNumber.toString() },
                'Received funding event logs from block poll'
              );
              for (const log of logs) {
                await this.handleFundingEvent(log);
              }
            }

            this.lastProcessedBlock = blockNumber;
          } catch (error) {
            this.logger.error({ error, blockNumber: blockNumber.toString() }, 'Failed to fetch funding logs');
          }
        },
        onError: (error) => {
          this.logger.error({ error }, 'Block number watcher error');
        },
      });
      this.logger.info('Funding event watcher started (using block polling)');
    }

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
   * Handle a funding event (EthBalanceUpdateRequested)
   */
  private async handleFundingEvent(log: Log): Promise<void> {
    const strategyAddress = log.address;
    const txHash = log.transactionHash;

    if (!txHash) {
      this.logger.warn({ log }, 'Funding log missing transaction hash');
      return;
    }

    this.logger.info(
      {
        strategy: strategyAddress,
        txHash,
      },
      'Funding event detected (EthBalanceUpdateRequested)'
    );

    try {
      // Fetch full transaction receipt to get ALL logs from this tx
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: txHash,
      });

      // Filter logs from this strategy only
      const strategyLogs = receipt.logs.filter(
        (l) => l.address.toLowerCase() === strategyAddress.toLowerCase()
      );

      this.logger.debug(
        {
          strategy: strategyAddress,
          totalLogs: receipt.logs.length,
          strategyLogs: strategyLogs.length,
        },
        'Funding event transaction receipt fetched'
      );

      // Call the funding event handler
      if (this.onFundingEvent) {
        await this.onFundingEvent(strategyAddress, strategyLogs, txHash);
      }
    } catch (error) {
      this.logger.error(
        {
          strategy: strategyAddress,
          txHash,
          error,
        },
        'Failed to process funding event'
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
    if (this.unwatchLifecycle) {
      this.unwatchLifecycle();
      this.unwatchLifecycle = null;
    }
    if (this.unwatchFunding) {
      this.unwatchFunding();
      this.unwatchFunding = null;
    }
    this.logger.info('Strategy watcher stopped');
  }
}
