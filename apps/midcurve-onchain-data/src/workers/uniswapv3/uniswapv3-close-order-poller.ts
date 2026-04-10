/**
 * CloseOrderSubscriber Worker
 *
 * Loads active UniswapV3PositionCloser contracts from the SharedContract registry,
 * creates polling batches, and manages their lifecycle.
 * Publishes incoming lifecycle events (registration, cancellation, config updates)
 * to RabbitMQ as structured domain events.
 *
 * Uses eth_getLogs polling instead of WebSocket subscriptions.
 * On startup, runs catch-up from cached block → current block, then starts
 * periodic polling for new events.
 */

import { SharedContractService, EvmConfig } from '@midcurve/services';
import { SharedContractNameEnum, type EvmSmartContractConfigData } from '@midcurve/shared';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import {
  getCatchUpConfig,
  isSupportedChain,
  SUPPORTED_CHAIN_IDS,
} from '../../lib/config';
import {
  UniswapV3CloserPollingBatch,
  type CloserContractInfo,
} from '../../polling/uniswap-v3-closer';
import {
  executeCloseOrderCatchUpFinalizedForChains,
  setCloseOrderLastProcessedBlock,
} from '../../catchup/close-order-catchup';

const log = onchainDataLogger.child({ component: 'CloseOrderSubscriber' });

/**
 * CloseOrderSubscriber manages polling batches for closer contract lifecycle events.
 */
export class CloseOrderSubscriber {
  private pollers: UniswapV3CloserPollingBatch[] = [];
  private isRunning = false;

  // Block tracking state (for cache updates)
  private blockTrackingTimer: NodeJS.Timeout | null = null;

  // Track contract addresses by chain for catch-up
  private contractsByChain: Map<number, string[]> = new Map();

  /**
   * Start the subscriber.
   * Loads active closer contracts, runs catch-up, and starts polling.
   *
   * Startup flow:
   * 1. Load closer contracts from SharedContract registry
   * 2. Run finalized block catch-up (cachedBlock → current block)
   * 3. Start polling batches for new events
   * 4. Start block tracking heartbeat
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'CloseOrderSubscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'starting');

    // 1. Load active closer contracts from database
    const contractsByChain = await this.loadActiveContracts();

    if (contractsByChain.size === 0) {
      log.warn({ msg: 'No active closer contracts found, subscriber will idle' });
      this.isRunning = true;
      return;
    }

    // 2. Run catch-up from cached block → current block
    await this.runCatchUp();

    // 3. Create and start polling batches
    for (const [chainId, contracts] of contractsByChain) {
      const poller = new UniswapV3CloserPollingBatch(chainId, contracts);
      this.pollers.push(poller);
      await poller.start();
    }

    this.isRunning = true;

    // 4. Start block tracking heartbeat
    this.startBlockTracking();

    const totalContracts = Array.from(contractsByChain.values()).reduce(
      (sum, contracts) => sum + contracts.length,
      0
    );

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'started', {
      pollerCount: this.pollers.length,
      totalContracts,
    });
  }

  /**
   * Stop the subscriber.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'CloseOrderSubscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'stopping');

    // Stop block tracking timer
    this.stopBlockTracking();

    // Stop all pollers
    await Promise.all(this.pollers.map((poller) => poller.stop()));
    this.pollers = [];
    this.contractsByChain.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'CloseOrderSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    pollerCount: number;
    pollers: Array<{
      chainId: number;
      contractCount: number;
      isRunning: boolean;
      lastProcessedBlock: string | null;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      pollerCount: this.pollers.length,
      pollers: this.pollers.map((poller) => poller.getStatus()),
    };
  }

  // ===========================================================================
  // Contract Loading
  // ===========================================================================

  /**
   * Load active UniswapV3PositionCloser contracts from SharedContract registry,
   * grouped by chain ID.
   */
  private async loadActiveContracts(): Promise<Map<number, CloserContractInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveContracts');

    const sharedContractService = new SharedContractService();
    const contractsByChain = new Map<number, CloserContractInfo[]>();

    for (const chainId of SUPPORTED_CHAIN_IDS) {
      if (!isSupportedChain(chainId)) continue;

      try {
        // Verify we have an RPC client for this chain
        const evmConfig = EvmConfig.getInstance();
        try {
          evmConfig.getPublicClient(chainId);
        } catch {
          log.debug({ chainId, msg: 'Chain not configured, skipping' });
          continue;
        }

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

        if (!contractsByChain.has(chainId)) {
          contractsByChain.set(chainId, []);
        }

        contractsByChain.get(chainId)!.push({
          address: config.address,
          chainId,
        });

        // Track for catch-up
        if (!this.contractsByChain.has(chainId)) {
          this.contractsByChain.set(chainId, []);
        }
        this.contractsByChain.get(chainId)!.push(config.address);

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
  // Catch-Up
  // ===========================================================================

  /**
   * Run catch-up from cached block → current finalized block.
   * Processes historical events before starting live polling.
   */
  private async runCatchUp(): Promise<void> {
    const config = getCatchUpConfig();

    if (!config.enabled) {
      log.info({ msg: 'Close order catch-up disabled by configuration' });
      return;
    }

    if (this.contractsByChain.size === 0) {
      log.info({ msg: 'No contracts to catch up' });
      return;
    }

    log.info({ msg: 'Running close order catch-up before starting polling' });
    const results = await executeCloseOrderCatchUpFinalizedForChains(this.contractsByChain);

    const totalEvents = results.reduce((sum, r) => sum + r.eventsPublished, 0);
    const failedChains = results.filter((r) => r.error).length;
    log.info({
      chainsProcessed: results.length,
      failedChains,
      totalEvents,
      msg: 'Close order catch-up completed',
    });
  }

  // ===========================================================================
  // Block Tracking
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
   * Heartbeat update for block tracking.
   */
  private async updateBlockTrackingHeartbeat(): Promise<void> {
    const evmConfig = EvmConfig.getInstance();

    for (const [chainId] of this.contractsByChain) {
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
}
