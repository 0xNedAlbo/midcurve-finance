/**
 * CloseOrderSubscriber Worker
 *
 * Loads active UniswapV3PositionCloser contracts from the SharedContract registry,
 * creates WebSocket subscription batches, and manages their lifecycle.
 * Publishes incoming lifecycle events (registration, cancellation, config updates)
 * to RabbitMQ as structured domain events.
 *
 * Unlike PositionLiquiditySubscriber, this subscriber:
 * - Uses contract addresses (not NFPM nftId topics) for filtering
 * - Loads contracts from SharedContract table (not Position table)
 * - Has no cleanup timer (contracts are static; new deployments handled by restart)
 * - Has no per-position buffering (all events use global buffering only)
 */

import { SharedContractService } from '@midcurve/services';
import { SharedContractNameEnum, type EvmSmartContractConfigData } from '@midcurve/shared';
import { EvmConfig } from '@midcurve/services';
import { onchainDataLogger, priceLog } from '../lib/logger';
import {
  getConfiguredWssUrls,
  getCatchUpConfig,
  isSupportedChain,
  type SupportedChainId,
} from '../lib/config';
import {
  UniswapV3CloserSubscriptionBatch,
  createCloserSubscriptionBatches,
  type CloserContractInfo,
} from '../ws/providers/uniswap-v3-closer';
import {
  executeCloseOrderCatchUpNonFinalizedForChains,
  executeCloseOrderCatchUpFinalizedForChains,
  setCloseOrderLastProcessedBlock,
  updateCloseOrderBlockIfHigher,
} from '../catchup/close-order-catchup';

const log = onchainDataLogger.child({ component: 'CloseOrderSubscriber' });

/**
 * CloseOrderSubscriber manages WebSocket subscriptions for closer contract lifecycle events.
 */
export class CloseOrderSubscriber {
  private batches: UniswapV3CloserSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3CloserSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Block tracking state (for catch-up on restart)
  private blockTrackingTimer: NodeJS.Timeout | null = null;

  // Track contract addresses by chain for catch-up
  private contractsByChain: Map<SupportedChainId, string[]> = new Map();

  /**
   * Start the subscriber.
   * Loads active closer contracts, creates WebSocket batches, and performs reorg-safe catch-up.
   *
   * Catch-up flow (reorg-safe):
   * 1. Load closer contracts from SharedContract registry
   * 2. Create WebSocket batches in BUFFERING mode
   * 3. Start WebSocket subscriptions (events buffered, not published)
   * 4. Scan NON-FINALIZED blocks (finalizedBlock+1 → currentBlock) - blocking
   * 5. Flush buffered events and switch to normal mode
   * 6. Start block tracking heartbeat
   * 7. Scan FINALIZED blocks in background (cachedBlock → finalizedBlock)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'CloseOrderSubscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'starting');

    try {
      // 1. Load active closer contracts from database
      const contractsByChain = await this.loadActiveContracts();

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({
          msg: 'No WS_RPC_URL_* environment variables configured, close order subscriber will not start',
        });
        return;
      }

      // 2. Create subscription batches for each configured chain
      for (const wssConfig of wssConfigs) {
        const chainId = wssConfig.chainId as SupportedChainId;
        const contracts = contractsByChain.get(chainId);

        if (!contracts || contracts.length === 0) {
          log.info({ chainId, msg: 'No active closer contracts for chain, skipping' });
          continue;
        }

        const chainBatches = createCloserSubscriptionBatches(chainId, wssConfig.url, contracts);
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);

        // Track contract addresses for catch-up
        this.contractsByChain.set(chainId, contracts.map((c) => c.address));
      }

      this.isRunning = true;

      // Set block update callback on all batches for block tracking
      for (const batch of this.batches) {
        batch.setBlockUpdateCallback((chainId, blockNumber) => {
          this.handleBlockUpdate(chainId, blockNumber);
        });
      }

      if (this.batches.length === 0) {
        log.warn({ msg: 'No closer subscription batches created, close order subscriber will idle' });
      } else {
        // 3-5. Execute reorg-safe catch-up with buffering
        await this.catchUpNonFinalizedBlocksWithBuffering();
      }

      // 6. Start block tracking heartbeat
      this.startBlockTracking();

      const totalContracts = this.batches.reduce(
        (sum, batch) => sum + batch.getStatus().contractCount,
        0
      );

      priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'started', {
        batchCount: this.batches.length,
        totalContracts,
      });

      // 7. Execute FINALIZED block catch-up in background
      this.catchUpFinalizedBlocksInBackground();
    } catch (error) {
      priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber.
   * Stops all WebSocket batches gracefully.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'CloseOrderSubscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'stopping');

    // Stop block tracking timer
    this.stopBlockTracking();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.contractsByChain.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    batchCount: number;
    batches: Array<{
      chainId: number;
      batchIndex: number;
      contractCount: number;
      isConnected: boolean;
      isRunning: boolean;
      isBuffering: boolean;
      bufferedEvents: number;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      batchCount: this.batches.length,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  // ===========================================================================
  // Contract Loading
  // ===========================================================================

  /**
   * Load active UniswapV3PositionCloser contracts from SharedContract registry,
   * grouped by chain ID.
   */
  private async loadActiveContracts(): Promise<Map<SupportedChainId, CloserContractInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveContracts');

    const sharedContractService = new SharedContractService();
    const contractsByChain = new Map<SupportedChainId, CloserContractInfo[]>();

    // Get configured WSS URLs to know which chains to check
    const wssConfigs = getConfiguredWssUrls();

    for (const wssConfig of wssConfigs) {
      const chainId = wssConfig.chainId;

      if (!isSupportedChain(chainId)) continue;

      const supportedChainId = chainId as SupportedChainId;

      try {
        const contract = await sharedContractService.findLatestByChainAndName(
          chainId,
          SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
        );

        if (!contract) {
          log.info({ chainId, msg: 'No active UniswapV3PositionCloser contract for chain' });
          continue;
        }

        const config = contract.config as EvmSmartContractConfigData;

        if (!config.address) {
          log.warn({ chainId, contractId: contract.id, msg: 'Contract config missing address' });
          continue;
        }

        if (!contractsByChain.has(supportedChainId)) {
          contractsByChain.set(supportedChainId, []);
        }

        contractsByChain.get(supportedChainId)!.push({
          address: config.address,
          chainId,
        });

        log.info({
          chainId,
          address: config.address,
          contractId: contract.id,
          version: `${contract.interfaceVersionMajor}.${contract.interfaceVersionMinor}`,
          msg: 'Loaded closer contract',
        });
      } catch (error) {
        log.warn({
          chainId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to load closer contract for chain',
        });
      }
    }

    // Log summary
    let totalContracts = 0;
    for (const [chainId, contracts] of contractsByChain) {
      log.info({ chainId, contractCount: contracts.length, msg: 'Closer contracts grouped by chain' });
      totalContracts += contracts.length;
    }

    log.info({ totalContracts, chainCount: contractsByChain.size, msg: 'Active closer contracts loaded' });

    priceLog.methodExit(log, 'loadActiveContracts');

    return contractsByChain;
  }

  // ===========================================================================
  // Block Tracking (for catch-up on restart)
  // ===========================================================================

  /**
   * Start the block tracking heartbeat timer.
   */
  private startBlockTracking(): void {
    const config = getCatchUpConfig();

    if (!config.enabled) {
      log.info({ msg: 'Close order block tracking disabled (catch-up disabled)' });
      return;
    }

    this.blockTrackingTimer = setInterval(() => {
      this.updateBlockTrackingHeartbeat().catch((err) => {
        log.warn({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Close order block tracking heartbeat failed',
        });
      });
    }, config.heartbeatIntervalMs);

    log.info({ intervalMs: config.heartbeatIntervalMs, msg: 'Started close order block tracking heartbeat' });
  }

  /**
   * Stop the block tracking heartbeat timer.
   */
  private stopBlockTracking(): void {
    if (this.blockTrackingTimer) {
      clearInterval(this.blockTrackingTimer);
      this.blockTrackingTimer = null;
      log.info({ msg: 'Stopped close order block tracking heartbeat' });
    }
  }

  /**
   * Handle block update from WebSocket event.
   */
  private handleBlockUpdate(chainId: number, blockNumber: bigint): void {
    updateCloseOrderBlockIfHigher(chainId, blockNumber).catch((err) => {
      log.warn({
        chainId,
        blockNumber: blockNumber.toString(),
        error: err instanceof Error ? err.message : String(err),
        msg: 'Failed to update close order block tracking from event',
      });
    });
  }

  /**
   * Heartbeat update for block tracking.
   */
  private async updateBlockTrackingHeartbeat(): Promise<void> {
    const evmConfig = EvmConfig.getInstance();

    for (const [chainId] of this.batchesByChain) {
      try {
        const client = evmConfig.getPublicClient(chainId);
        const currentBlock = await client.getBlockNumber();
        await setCloseOrderLastProcessedBlock(chainId, currentBlock);
        log.debug({ chainId, blockNumber: currentBlock.toString(), msg: 'Close order block tracking heartbeat' });
      } catch (err) {
        log.warn({
          chainId,
          error: err instanceof Error ? err.message : String(err),
          msg: 'Failed to update close order block tracking heartbeat',
        });
      }
    }
  }

  // ===========================================================================
  // Catch-Up with Buffering
  // ===========================================================================

  /**
   * Catch up non-finalized blocks while WebSocket buffers incoming events.
   *
   * Flow:
   * 1. Enable buffering on all batches
   * 2. Start WebSocket subscriptions (events go to buffer)
   * 3. Scan non-finalized blocks (finalizedBlock+1 → currentBlock)
   * 4. Flush buffered events and switch to normal mode
   */
  private async catchUpNonFinalizedBlocksWithBuffering(): Promise<void> {
    const config = getCatchUpConfig();

    // 1. Enable buffering on all batches
    for (const batch of this.batches) {
      batch.enableBuffering();
    }

    // 2. Start WebSocket subscriptions (events will be buffered)
    log.info({ msg: 'Starting closer WebSocket subscriptions in buffering mode' });
    await Promise.all(this.batches.map((batch) => batch.start()));

    // 3. Scan non-finalized blocks if catch-up is enabled
    if (config.enabled) {
      log.info({ msg: 'Scanning non-finalized blocks for close orders (blocking)' });
      const results = await executeCloseOrderCatchUpNonFinalizedForChains(this.contractsByChain);

      const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
      const failedChains = results.filter((r) => r.error).length;
      log.info({
        chainsProcessed: results.length,
        failedChains,
        totalEvents,
        msg: 'Non-finalized close order catch-up completed',
      });
    }

    // 4. Flush buffered events and switch to normal mode
    let totalFlushed = 0;
    for (const batch of this.batches) {
      const flushed = await batch.flushBufferAndDisableBuffering();
      totalFlushed += flushed;
    }

    log.info({
      totalFlushedEvents: totalFlushed,
      msg: 'Buffered close order events flushed, now in normal mode',
    });
  }

  /**
   * Execute finalized block catch-up in background.
   * Safe to run in background since finalized blocks are immutable.
   */
  private catchUpFinalizedBlocksInBackground(): void {
    const config = getCatchUpConfig();

    if (!config.enabled) {
      log.info({ msg: 'Finalized close order catch-up disabled by configuration' });
      return;
    }

    log.info({ msg: 'Starting finalized close order catch-up in background' });
    executeCloseOrderCatchUpFinalizedForChains(this.contractsByChain)
      .then((results) => {
        const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
        const failedChains = results.filter((r) => r.error).length;
        log.info({
          chainsProcessed: results.length,
          failedChains,
          totalEvents,
          msg: 'Background finalized close order catch-up completed',
        });
      })
      .catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Background finalized close order catch-up failed',
        });
      });
  }
}
