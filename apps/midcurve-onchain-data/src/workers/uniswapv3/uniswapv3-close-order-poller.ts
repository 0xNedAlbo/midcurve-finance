/**
 * CloseOrderSubscriber Worker
 *
 * Loads active UniswapV3PositionCloser and UniswapV3VaultPositionCloser contracts
 * from the SharedContract registry, creates polling batches, and manages their
 * lifecycle.
 * Publishes incoming lifecycle events (registration, cancellation, config updates)
 * to RabbitMQ as structured domain events.
 *
 * Uses eth_getLogs polling instead of WebSocket subscriptions. There is no
 * separate startup catch-up: each poller's first sweep covers everything from
 * its cursor to the chain head, and starting a poller does not wait for it.
 */

import { SharedContractService, EvmConfig } from '@midcurve/services';
import { SharedContractNameEnum, type EvmSmartContractConfigData } from '@midcurve/shared';
import { onchainDataLogger, priceLog } from '../../lib/logger';
import {
  getCloseOrderCursorConfig,
  isSupportedChain,
  SUPPORTED_CHAIN_IDS,
} from '../../lib/config';
import {
  UniswapV3CloserPollingBatch,
  type CloserContractInfo,
} from '../../polling/uniswap-v3-closer';
import { updateCloseOrderBlockIfHigher } from '../../catchup/close-order-catchup';

const log = onchainDataLogger.child({ component: 'CloseOrderSubscriber' });

/**
 * CloseOrderSubscriber manages polling batches for closer contract lifecycle events.
 */
export class CloseOrderSubscriber {
  private pollers: UniswapV3CloserPollingBatch[] = [];
  private isRunning = false;

  // Block tracking state (for cache updates)
  private blockTrackingTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads active closer contracts and starts polling.
   *
   * Startup flow:
   * 1. Load closer contracts from SharedContract registry
   * 2. Start polling batches — each fires its first sweep immediately and does
   *    not block the next one (#88)
   * 3. Start block tracking heartbeat (re-persists what the pollers scanned)
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

    // 2. Create and start polling batches
    for (const [chainId, contracts] of contractsByChain) {
      const poller = new UniswapV3CloserPollingBatch(chainId, contracts);
      this.pollers.push(poller);
      await poller.start();
    }

    this.isRunning = true;

    // 3. Start block tracking heartbeat
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
   * Load active closer contracts from the SharedContract registry, grouped by
   * chain ID.
   *
   * Both the NFT closer and the vault closer are loaded — the fallback path has
   * to cover direct contract interaction for either protocol.
   */
  private async loadActiveContracts(): Promise<Map<number, CloserContractInfo[]>> {
    priceLog.methodEntry(log, 'loadActiveContracts');

    const sharedContractService = new SharedContractService();
    const contractsByChain = new Map<number, CloserContractInfo[]>();

    const CLOSER_CONTRACT_NAMES = [
      SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER,
      SharedContractNameEnum.UNISWAP_V3_VAULT_POSITION_CLOSER,
    ];

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

        for (const contractName of CLOSER_CONTRACT_NAMES) {
          const contract = await sharedContractService.findLatestByChainAndName(
            chainId,
            contractName
          );

          if (!contract) {
            log.info({ chainId, contractName, msg: 'No active closer contract for chain' });
            continue;
          }

          const config = contract.config as EvmSmartContractConfigData;

          if (!config.address) {
            log.warn({ chainId, contractId: contract.id, contractName, msg: 'Contract config missing address' });
            continue;
          }

          if (!contractsByChain.has(chainId)) {
            contractsByChain.set(chainId, []);
          }

          contractsByChain.get(chainId)!.push({
            address: config.address,
            chainId,
          });

          log.info({
            chainId,
            contractName,
            address: config.address,
            contractId: contract.id,
            version: `${contract.interfaceVersionMajor}.${contract.interfaceVersionMinor}`,
            msg: 'Loaded closer contract',
          });
        }
      } catch (error) {
        log.warn({
          chainId,
          error: error instanceof Error ? error.message : String(error),
          msg: 'Failed to load closer contracts for chain',
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
  // Block Tracking
  // ===========================================================================

  /**
   * Start the block tracking heartbeat timer.
   */
  private startBlockTracking(): void {
    const config = getCloseOrderCursorConfig();

    if (!config.enabled) {
      log.info({ msg: 'Close order cursor heartbeat disabled by configuration' });
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
   *
   * Re-persists each poller's scanned watermark — the highest block that has
   * actually been through eth_getLogs — so the restart cursor survives a cache
   * write that failed inside `poll()` (those failures are swallowed and warned,
   * never retried), and so the cache row's `updatedAt` stays a liveness signal.
   *
   * It deliberately does NOT read the chain head. Persisting the head here
   * would claim every block up to it had been scanned, and a restart would then
   * resume past everything the poller had not yet looked at — silently, since
   * an unscanned range and an empty one produce identical logs.
   *
   * Pollers that have not completed a scan report null and are skipped: their
   * in-memory position is a starting point, not a result.
   */
  private async updateBlockTrackingHeartbeat(): Promise<void> {
    for (const poller of this.pollers) {
      const scannedBlock = poller.getLastScannedBlock();

      if (scannedBlock === null) {
        log.debug({ chainId: poller.chainId, msg: 'No completed scan yet, skipping cursor heartbeat' });
        continue;
      }

      try {
        await updateCloseOrderBlockIfHigher(poller.chainId, scannedBlock);
        log.debug({
          chainId: poller.chainId,
          blockNumber: scannedBlock.toString(),
          msg: 'Close order block tracking heartbeat',
        });
      } catch (err) {
        log.warn({
          chainId: poller.chainId,
          error: err instanceof Error ? err.message : String(err),
          msg: 'Failed to update close order block tracking heartbeat',
        });
      }
    }
  }
}
