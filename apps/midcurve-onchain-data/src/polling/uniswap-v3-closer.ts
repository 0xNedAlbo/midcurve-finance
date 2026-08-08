/**
 * Uniswap V3 Position Closer Provider — HTTP Polling (Fallback)
 *
 * Polls for close order lifecycle events using eth_getLogs as a safety net.
 * Primary event delivery is via receipt extraction in the API (user actions)
 * and automation executor (order execution). This poller catches any events
 * from direct contract interactions.
 *
 * Default interval: 1 hour (configurable via CLOSER_POLL_INTERVAL_MS).
 * Tracks last processed block per chain via CacheService (Postgres-backed)
 * and publishes decoded domain events to RabbitMQ.
 */

import { EvmConfig, closeOrderRoutingKeyForEvent } from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import {
  serializeCloseOrderEvent,
} from '../mq/close-order-messages';
import {
  fetchHistoricalCloseOrderEvents,
  getCloseOrderLastProcessedBlock,
  setCloseOrderLastProcessedBlock,
} from '../catchup/close-order-catchup';

const log = onchainDataLogger.child({ component: 'UniswapV3CloserPoller' });

/** Polling interval for eth_getLogs reads (default: 1 hour, fallback safety net) */
const POLL_INTERVAL_MS = parseInt(process.env.CLOSER_POLL_INTERVAL_MS || '3600000', 10);

/** Maximum blocks per eth_getLogs request */
const BATCH_SIZE_BLOCKS = parseInt(process.env.CLOSER_POLL_BATCH_SIZE || '10000', 10);

/**
 * Contract info for polling.
 */
export interface CloserContractInfo {
  address: string;
  chainId: number;
}

/**
 * UniswapV3CloserPollingBatch polls for lifecycle events from closer contracts
 * on a single chain using eth_getLogs.
 */
export class UniswapV3CloserPollingBatch {
  public readonly chainId: number;
  private readonly contractAddresses: string[];
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastProcessedBlock: bigint | null = null;

  /**
   * Whether a poll cycle has actually scanned a range on this batch.
   *
   * `lastProcessedBlock` is seeded from the chain head when the cache holds no
   * cursor (see `start()`), and at that moment nothing has been scanned. The
   * flag separates "this is where we start looking" from "this is what we have
   * looked at", so the heartbeat can only ever persist the latter.
   *
   * Edge worth knowing: with no cached cursor AND catch-up disabled, this stays
   * false for a full poll interval, so nothing is persisted and a restart in
   * that window re-seeds from the head — the same skip, bounded to one interval
   * instead of unbounded. In normal operation catch-up writes the cursor before
   * any poller starts, so the window never opens. The cold-start cursor does
   * therefore still depend on catch-up having run; what no longer depends on it
   * is every subsequent restart.
   */
  private hasCompletedScan = false;

  constructor(chainId: number, contracts: CloserContractInfo[]) {
    this.chainId = chainId;
    this.contractAddresses = contracts.map((c) => c.address);
  }

  /**
   * Start polling for events.
   * Loads last processed block from cache and begins periodic polling.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // Load last processed block from cache
    this.lastProcessedBlock = await getCloseOrderLastProcessedBlock(this.chainId);

    if (this.lastProcessedBlock === null) {
      // First run: start from current block (catch-up handles historical)
      const evmConfig = EvmConfig.getInstance();
      const client = evmConfig.getPublicClient(this.chainId);
      this.lastProcessedBlock = await client.getBlockNumber();

      log.info({
        chainId: this.chainId,
        startBlock: this.lastProcessedBlock.toString(),
        msg: 'No cached block, starting from current block',
      });
    }

    this.isRunning = true;

    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        log.error({
          chainId: this.chainId,
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling close order events',
        });
      });
    }, POLL_INTERVAL_MS);

    log.info({
      chainId: this.chainId,
      intervalMs: POLL_INTERVAL_MS,
      contractCount: this.contractAddresses.length,
      lastBlock: this.lastProcessedBlock.toString(),
      msg: 'Started close order polling',
    });
  }

  /**
   * Stop polling.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.isRunning = false;

    log.info({ chainId: this.chainId, msg: 'Stopped close order polling' });
  }

  /**
   * Highest block this batch has actually scanned and published, or null if no
   * poll cycle has completed yet.
   *
   * This is the only value safe to persist as the restart cursor: everything up
   * to it has been through `eth_getLogs`. Returns null rather than the seeded
   * chain head so a caller cannot mistake "where polling began" for "what has
   * been scanned".
   */
  getLastScannedBlock(): bigint | null {
    return this.hasCompletedScan ? this.lastProcessedBlock : null;
  }

  /**
   * Get status.
   */
  getStatus(): {
    chainId: number;
    contractCount: number;
    isRunning: boolean;
    lastProcessedBlock: string | null;
  } {
    return {
      chainId: this.chainId,
      contractCount: this.contractAddresses.length,
      isRunning: this.isRunning,
      lastProcessedBlock: this.lastProcessedBlock?.toString() ?? null,
    };
  }

  /**
   * Single poll cycle: fetch events from lastBlock+1 → currentBlock.
   */
  private async poll(): Promise<void> {
    if (this.lastProcessedBlock === null) return;

    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(this.chainId);
    const currentBlock = await client.getBlockNumber();

    const fromBlock = this.lastProcessedBlock + 1n;
    if (fromBlock > currentBlock) return;

    const events = await fetchHistoricalCloseOrderEvents({
      chainId: this.chainId,
      contractAddresses: this.contractAddresses,
      fromBlock,
      toBlock: currentBlock,
      batchSize: BATCH_SIZE_BLOCKS,
    });

    if (events.length > 0) {
      const mq = getRabbitMQConnection();
      let publishedCount = 0;

      // Per-event isolation: one unusable event must not take the rest of the
      // batch down with it. Matches the catch-up publishers.
      for (const { event } of events) {
        if (!event) continue;
        try {
          const routingKey = closeOrderRoutingKeyForEvent(event);
          const content = serializeCloseOrderEvent(event);
          await mq.publishCloseOrderEvent(routingKey, content);
          publishedCount++;
        } catch (error) {
          log.warn({
            chainId: this.chainId,
            eventType: event.type,
            nftId: event.nftId,
            vaultAddress: event.vaultAddress,
            ownerAddress: event.ownerAddress,
            txHash: event.transactionHash,
            error: error instanceof Error ? error.message : String(error),
            msg: 'Failed to publish close order event from poll, skipping',
          });
        }
      }

      log.info({
        chainId: this.chainId,
        fromBlock: fromBlock.toString(),
        toBlock: currentBlock.toString(),
        eventsPublished: publishedCount,
        msg: 'Published close order events from poll',
      });
    }

    // Update tracking. The range fromBlock→currentBlock has now been through
    // eth_getLogs, so it is honest to both advance the watermark and let the
    // heartbeat persist it.
    this.lastProcessedBlock = currentBlock;
    this.hasCompletedScan = true;
    await setCloseOrderLastProcessedBlock(this.chainId, currentBlock);
  }
}
