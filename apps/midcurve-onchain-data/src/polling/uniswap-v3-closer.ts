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

import { EvmConfig } from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import { buildCloseOrderRoutingKey } from '../mq/topology';
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
  private readonly chainId: number;
  private readonly contractAddresses: string[];
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastProcessedBlock: bigint | null = null;

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

      for (const { event } of events) {
        if (!event || !event.nftId) continue;
        const routingKey = buildCloseOrderRoutingKey(this.chainId, event.nftId, event.triggerMode);
        const content = serializeCloseOrderEvent(event);
        await mq.publishCloseOrderEvent(routingKey, content);
        publishedCount++;
      }

      log.info({
        chainId: this.chainId,
        fromBlock: fromBlock.toString(),
        toBlock: currentBlock.toString(),
        eventsPublished: publishedCount,
        msg: 'Published close order events from poll',
      });
    }

    // Update tracking
    this.lastProcessedBlock = currentBlock;
    await setCloseOrderLastProcessedBlock(this.chainId, currentBlock);
  }
}
