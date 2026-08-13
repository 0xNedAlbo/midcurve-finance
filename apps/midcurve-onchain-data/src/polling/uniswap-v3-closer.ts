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
   * `lastProcessedBlock` starts as the persisted cursor, or null when there is
   * none — and null means "scan from block 0", not "we are up to date". Nothing
   * has been scanned at that point either way. The flag separates "this is where
   * we start looking" from "this is what we have looked at", so the heartbeat
   * can only ever persist the latter.
   *
   * The cold-start window this used to describe — nothing persisted for a full
   * poll interval on an empty cache, because catch-up wrote the first cursor —
   * closed with the immediate first sweep in `start()` (#88).
   */
  private hasCompletedScan = false;

  /**
   * Whether a sweep is in flight.
   *
   * A cold-cursor sweep can run for up to the scan timeout (120s) while
   * CLOSER_POLL_INTERVAL_MS is 60s in the dev environment, so the interval can
   * fire on top of a sweep that has not finished. Two concurrent sweeps would
   * race on the cursor write and the older one could land last, moving the
   * cursor backwards over blocks that were already published.
   */
  private isPolling = false;

  constructor(chainId: number, contracts: CloserContractInfo[]) {
    this.chainId = chainId;
    this.contractAddresses = contracts.map((c) => c.address);
  }

  /**
   * Start polling for events.
   *
   * Loads the cursor, arms the interval, and fires the first sweep immediately —
   * without awaiting it. Both halves of that carry weight:
   *
   * - Without the immediate sweep, nothing is scanned for a full
   *   CLOSER_POLL_INTERVAL_MS (one hour by default) after startup. Deleting the
   *   catch-up without this would have traded one startup defect for another,
   *   invisibly, since an unscanned range logs identically to an empty one.
   * - Without "not awaited", CloseOrderSubscriber's sequential start loop would
   *   make each chain's poller wait for the previous chain's full-history sweep,
   *   which is the backfill-blocks-polling defect this replaced. See #88.
   *
   * An empty cache leaves the cursor null, which `poll()` reads as block 0. The
   * historical range is scanned by the poller now; nothing else scans it.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // No cursor means no scan has happened for this chain, so the sweep starts
    // at genesis. It is one request either way (#88).
    this.lastProcessedBlock = await getCloseOrderLastProcessedBlock(this.chainId);

    this.isRunning = true;

    this.pollTimer = setInterval(() => {
      void this.runPoll();
    }, POLL_INTERVAL_MS);

    log.info({
      chainId: this.chainId,
      intervalMs: POLL_INTERVAL_MS,
      contractCount: this.contractAddresses.length,
      lastBlock: this.lastProcessedBlock?.toString() ?? 'none, scanning from block 0',
      msg: 'Started close order polling',
    });

    // Deliberately not awaited — see the note above.
    void this.runPoll();
  }

  /**
   * Worker entry point for one poll cycle: everything below throws, and this is
   * where it becomes a log line.
   *
   * A failed sweep or a failed publish leaves the cursor untouched, so the same
   * range is retried on the next tick. That is the point — the previous
   * behaviour reported "0 events found" and moved on.
   */
  private async runPoll(): Promise<void> {
    try {
      await this.poll();
    } catch (err) {
      log.error({
        chainId: this.chainId,
        error: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined,
        msg: 'Close order poll failed, cursor left unchanged',
      });
    }
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
   * Single poll cycle: fetch events from lastBlock+1 → currentBlock, or from
   * block 0 when there is no cursor yet.
   */
  private async poll(): Promise<void> {
    if (this.isPolling) {
      log.warn({
        chainId: this.chainId,
        msg: 'Close order sweep still in flight, skipping this tick',
      });
      return;
    }

    this.isPolling = true;
    try {
      await this.sweep();
    } finally {
      this.isPolling = false;
    }
  }

  private async sweep(): Promise<void> {
    const evmConfig = EvmConfig.getInstance();
    const client = evmConfig.getPublicClient(this.chainId);
    const currentBlock = await client.getBlockNumber();

    const fromBlock = this.lastProcessedBlock === null ? 0n : this.lastProcessedBlock + 1n;
    if (fromBlock > currentBlock) return;

    const events = await fetchHistoricalCloseOrderEvents({
      chainId: this.chainId,
      contractAddresses: this.contractAddresses,
      fromBlock,
      toBlock: currentBlock,
    });

    if (events.length > 0) {
      const mq = getRabbitMQConnection();
      let publishedCount = 0;

      // A publish failure aborts the cycle, leaving the cursor where it was.
      //
      // This reverses the per-event isolation added in 34de883b. That change
      // stopped one bad event killing the batch, and the rationale assumed
      // event-specific publish failures exist. They do not:
      // publishCloseOrderEvent throws only via getChannel() or a closed channel,
      // both connection-wide, so the blast radius it isolated never had more
      // than one member. What the isolation did buy was Defect 2b of #88 — an
      // event decoded successfully, failed to publish, and was then lost
      // permanently because the cursor advanced past it anyway.
      //
      // Replaying the whole range on the next cycle is the cost, and #79 made
      // that idempotent for the automation log.
      for (const { event } of events) {
        if (!event) continue;
        try {
          const routingKey = closeOrderRoutingKeyForEvent(event);
          const content = serializeCloseOrderEvent(event);
          await mq.publishCloseOrderEvent(routingKey, content);
          publishedCount++;
        } catch (error) {
          // Logged here rather than at the boundary because only this frame
          // knows which event failed and how far the batch got. Then re-thrown:
          // the cursor write below must not run.
          log.error({
            chainId: this.chainId,
            eventType: event.type,
            nftId: event.nftId,
            vaultAddress: event.vaultAddress,
            ownerAddress: event.ownerAddress,
            txHash: event.transactionHash,
            fromBlock: fromBlock.toString(),
            toBlock: currentBlock.toString(),
            publishedBeforeFailure: publishedCount,
            error: error instanceof Error ? error.message : String(error),
            msg: 'Failed to publish close order event, aborting poll with the cursor unchanged',
          });
          throw error;
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

    // Update tracking. Reaching this line means the range fromBlock→currentBlock
    // went through eth_getLogs AND every event it produced was published, so it
    // is honest to both advance the watermark and let the heartbeat persist it.
    // Either failure throws before here and the cursor stands.
    this.lastProcessedBlock = currentBlock;
    this.hasCompletedScan = true;
    await setCloseOrderLastProcessedBlock(this.chainId, currentBlock);
  }
}
