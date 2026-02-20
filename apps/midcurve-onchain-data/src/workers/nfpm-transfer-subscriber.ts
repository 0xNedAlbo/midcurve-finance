/**
 * NfpmTransferSubscriber Worker
 *
 * Subscribes to ERC-721 Transfer events from the NonfungiblePositionManager
 * contract to detect position lifecycle events (MINT, BURN, TRANSFER).
 *
 * Loads all user wallet addresses from the database, creates WebSocket
 * subscription batches per chain, and publishes events to RabbitMQ.
 *
 * Periodically syncs with the database to pick up newly registered users.
 */

import { prisma } from '@midcurve/database';
import { onchainDataLogger, priceLog } from '../lib/logger';
import {
  getConfiguredWssUrls,
  type SupportedChainId,
} from '../lib/config';
import {
  UniswapV3NfpmTransferSubscriptionBatch,
  createNfpmTransferSubscriptionBatches,
} from '../ws/providers/uniswap-v3-nfpm-transfer';

const log = onchainDataLogger.child({ component: 'NfpmTransferSubscriber' });

/** Interval for syncing new wallet addresses (default: 60 seconds) */
const WALLET_SYNC_INTERVAL_MS = parseInt(process.env.NFPM_TRANSFER_WALLET_SYNC_INTERVAL_MS || '60000', 10);

/**
 * NfpmTransferSubscriber manages WebSocket subscriptions for NFPM Transfer events.
 *
 * Watches all registered user wallets across all configured chains for:
 * - MINT (from=0x0): New position created
 * - BURN (to=0x0): Position destroyed
 * - TRANSFER: Ownership change
 */
export class NfpmTransferSubscriber {
  private batches: UniswapV3NfpmTransferSubscriptionBatch[] = [];
  private batchesByChain: Map<SupportedChainId, UniswapV3NfpmTransferSubscriptionBatch[]> = new Map();
  private isRunning = false;

  // Track known wallet addresses (lowercase)
  private trackedWallets: Set<string> = new Set();

  // Periodic sync timer
  private walletSyncTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Loads user wallets and creates WebSocket batches for each chain.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'NfpmTransferSubscriber', 'starting');

    try {
      // Load all user wallet addresses
      const walletAddresses = await this.loadTrackedWallets();

      if (walletAddresses.length === 0) {
        log.info({ msg: 'No user wallets found, subscriber will idle until wallets are synced' });
      }

      // Get configured WSS URLs
      const wssConfigs = getConfiguredWssUrls();

      if (wssConfigs.length === 0) {
        log.warn({
          msg: 'No WS_RPC_URL_* environment variables configured, subscriber will not start.',
        });
        return;
      }

      // Create subscription batches for each configured chain
      for (const wssConfig of wssConfigs) {
        const chainId = wssConfig.chainId as SupportedChainId;

        if (walletAddresses.length === 0) {
          continue;
        }

        const chainBatches = createNfpmTransferSubscriptionBatches(
          chainId,
          wssConfig.url,
          walletAddresses,
        );
        this.batches.push(...chainBatches);
        this.batchesByChain.set(chainId, chainBatches);
      }

      this.isRunning = true;

      if (this.batches.length > 0) {
        // Start all batches
        await Promise.all(this.batches.map((batch) => batch.start()));
      }

      // Start periodic wallet sync
      this.startWalletSync();

      priceLog.workerLifecycle(log, 'NfpmTransferSubscriber', 'started', {
        batchCount: this.batches.length,
        walletCount: this.trackedWallets.size,
        chainCount: this.batchesByChain.size,
      });
    } catch (error) {
      priceLog.workerLifecycle(log, 'NfpmTransferSubscriber', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the subscriber.
   * Stops all WebSocket batches and cleans up.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'NfpmTransferSubscriber', 'stopping');

    // Stop wallet sync timer
    this.stopWalletSync();

    // Stop all batches
    await Promise.all(this.batches.map((batch) => batch.stop()));
    this.batches = [];
    this.batchesByChain.clear();
    this.trackedWallets.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'NfpmTransferSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    walletCount: number;
    batchCount: number;
    batches: Array<{
      chainId: number;
      batchIndex: number;
      walletCount: number;
      isConnected: boolean;
      isRunning: boolean;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      walletCount: this.trackedWallets.size,
      batchCount: this.batches.length,
      batches: this.batches.map((batch) => batch.getStatus()),
    };
  }

  // ===========================================================================
  // Wallet Loading & Sync
  // ===========================================================================

  /**
   * Load all user wallet addresses from the database.
   * Returns a deduplicated list of lowercase addresses.
   */
  private async loadTrackedWallets(): Promise<string[]> {
    priceLog.methodEntry(log, 'loadTrackedWallets');

    const users = await prisma.user.findMany({
      select: { address: true },
    });

    const wallets: string[] = [];
    for (const user of users) {
      const normalized = user.address.toLowerCase();
      if (!this.trackedWallets.has(normalized)) {
        this.trackedWallets.add(normalized);
      }
      wallets.push(normalized);
    }

    log.info({ walletCount: wallets.length, msg: 'Loaded tracked wallets' });
    priceLog.methodExit(log, 'loadTrackedWallets');

    return wallets;
  }

  /**
   * Start periodic wallet sync timer.
   */
  private startWalletSync(): void {
    this.walletSyncTimer = setInterval(() => {
      this.syncNewWallets().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error syncing new wallets',
        });
      });
    }, WALLET_SYNC_INTERVAL_MS);

    log.info({ intervalMs: WALLET_SYNC_INTERVAL_MS, msg: 'Started wallet sync timer' });
  }

  /**
   * Stop periodic wallet sync timer.
   */
  private stopWalletSync(): void {
    if (this.walletSyncTimer) {
      clearInterval(this.walletSyncTimer);
      this.walletSyncTimer = null;
      log.info({ msg: 'Stopped wallet sync timer' });
    }
  }

  /**
   * Sync new wallets from the database.
   * Adds any wallets not yet tracked to all chain batches.
   */
  private async syncNewWallets(): Promise<void> {
    const users = await prisma.user.findMany({
      select: { address: true },
    });

    const newWallets: string[] = [];
    for (const user of users) {
      const normalized = user.address.toLowerCase();
      if (!this.trackedWallets.has(normalized)) {
        newWallets.push(normalized);
        this.trackedWallets.add(normalized);
      }
    }

    if (newWallets.length === 0) {
      return;
    }

    log.info({ count: newWallets.length, msg: 'Found new wallets to track' });

    // Add each new wallet to all chain batches
    for (const wallet of newWallets) {
      await this.addWalletToAllChains(wallet);
    }
  }

  /**
   * Add a wallet address to subscription batches on all configured chains.
   */
  private async addWalletToAllChains(walletAddress: string): Promise<void> {
    const wssConfigs = getConfiguredWssUrls();

    for (const wssConfig of wssConfigs) {
      const chainId = wssConfig.chainId as SupportedChainId;
      await this.addWalletToBatch(chainId, wssConfig.url, walletAddress);
    }
  }

  /**
   * Add a wallet to an existing batch or create a new batch if needed.
   */
  private async addWalletToBatch(
    chainId: SupportedChainId,
    wssUrl: string,
    walletAddress: string,
  ): Promise<void> {
    let chainBatches = this.batchesByChain.get(chainId);

    if (!chainBatches) {
      chainBatches = [];
      this.batchesByChain.set(chainId, chainBatches);
    }

    // Find a batch with capacity
    let targetBatch = chainBatches.find((batch) => batch.hasCapacity());

    if (targetBatch) {
      await targetBatch.addWallet(walletAddress);
    } else {
      // Create a new batch
      const batchIndex = chainBatches.length;
      const newBatch = new UniswapV3NfpmTransferSubscriptionBatch(
        chainId,
        wssUrl,
        batchIndex,
        [walletAddress],
      );
      chainBatches.push(newBatch);
      this.batches.push(newBatch);

      await newBatch.start();
      log.info({
        chainId,
        batchIndex,
        walletAddress,
        msg: 'Created new transfer batch for wallet',
      });
    }
  }
}
