/**
 * Erc20BalanceSubscriber Worker
 *
 * Polls ERC-20 token balances using multicall for all active subscriptions.
 * Replaces the previous WebSocket-based approach that subscribed to Transfer
 * events. Multicall batches all balanceOf() reads into a single RPC call per
 * chain, deduplicating identical wallet+token pairs.
 *
 * Lifecycle:
 * - active: included in multicall polling
 * - paused: removed from polling after expiry without client heartbeat
 * - deleted: cleaned up after 5min in paused state
 *
 * API endpoint handles reactivation when a paused subscription is polled.
 */

import { prisma, Prisma } from '@midcurve/database';
import { onchainDataLogger, priceLog } from '../lib/logger.js';
import {
  isSupportedChain,
  CHAIN_NAMES,
  SUPPORTED_CHAIN_IDS,
  type SupportedChainId,
} from '../lib/config.js';
import type {
  Erc20BalanceSubscriptionConfig,
  Erc20BalanceSubscriptionState,
} from '@midcurve/shared';
import { getEvmConfig } from '@midcurve/services';
import { type PublicClient, getAddress } from 'viem';

const log = onchainDataLogger.child({ component: 'Erc20BalanceSubscriber' });

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.BALANCE_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.BALANCE_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.BALANCE_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling DB for new subscriptions (default: 5 seconds) */
const DB_POLL_INTERVAL_MS = parseInt(process.env.BALANCE_POLL_INTERVAL_MS || '5000', 10);

/** Interval for polling balances via multicall (default: 5 seconds) */
const BALANCE_POLL_INTERVAL_MS = parseInt(process.env.BALANCE_MULTICALL_INTERVAL_MS || '5000', 10);

/** Maximum balanceOf calls per multicall request */
const MULTICALL_BATCH_SIZE = parseInt(process.env.BALANCE_MULTICALL_BATCH_SIZE || '256', 10);

/** ERC-20 balanceOf ABI */
const balanceOfAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Balance subscription info for tracking.
 */
interface BalanceSubscriptionInfo {
  /** Database row ID */
  id: string;
  /** Unique subscription ID for API polling */
  subscriptionId: string;
  /** Chain ID */
  chainId: SupportedChainId;
  /** ERC-20 token contract address (checksummed) */
  tokenAddress: string;
  /** Wallet address to track balance for (checksummed) */
  walletAddress: string;
}

/**
 * Erc20BalanceSubscriber polls ERC-20 balances via multicall.
 * Subscriptions are created via the API and managed by this worker.
 */
export class Erc20BalanceSubscriber {
  private isRunning = false;

  // Track subscribed balances by subscriptionId
  private subscribedBalances: Map<string, BalanceSubscriptionInfo> = new Map();

  // In-memory cache of last known balance per subscriptionId (avoids unnecessary DB writes)
  private lastKnownBalances: Map<string, string> = new Map();

  // HTTP RPC clients per chain
  private clients: Map<SupportedChainId, PublicClient> = new Map();

  // Timers
  private balancePollTimer: NodeJS.Timeout | null = null;
  private dbPollTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * Start the subscriber.
   * Initializes RPC clients, loads active subscriptions, and starts polling.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'Subscriber already running' });
      return;
    }

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'starting');

    // Initialize HTTP clients for all configured chains
    this.initializeClients();

    if (this.clients.size === 0) {
      log.warn({
        msg: 'No RPC clients configured, subscriber will not start. Set RPC_URL_ETHEREUM, RPC_URL_ARBITRUM, etc.',
      });
      return;
    }

    // Load active subscriptions from database
    await this.loadActiveSubscriptions();

    this.isRunning = true;

    // Start balance polling (multicall)
    this.startBalancePolling();

    // Start DB polling (discover new subscriptions)
    this.startDbPolling();

    // Start cleanup timer (pause stale, prune deleted)
    this.startCleanup();

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'started', {
      subscriptionCount: this.subscribedBalances.size,
      clientCount: this.clients.size,
    });
  }

  /**
   * Stop the subscriber.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'Subscriber not running' });
      return;
    }

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'stopping');

    // Stop timers
    this.stopBalancePolling();
    this.stopDbPolling();
    this.stopCleanup();

    // Clear state
    this.subscribedBalances.clear();
    this.lastKnownBalances.clear();
    this.clients.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'Erc20BalanceSubscriber', 'stopped');
  }

  /**
   * Get subscriber status.
   */
  getStatus(): {
    isRunning: boolean;
    subscriptionCount: number;
    clientCount: number;
    subscriptionsByChain: Record<number, number>;
  } {
    const subscriptionsByChain: Record<number, number> = {};
    for (const sub of this.subscribedBalances.values()) {
      subscriptionsByChain[sub.chainId] = (subscriptionsByChain[sub.chainId] || 0) + 1;
    }

    return {
      isRunning: this.isRunning,
      subscriptionCount: this.subscribedBalances.size,
      clientCount: this.clients.size,
      subscriptionsByChain,
    };
  }

  /**
   * Initialize HTTP clients for all supported chains.
   */
  private initializeClients(): void {
    const evmConfig = getEvmConfig();

    for (const chainId of SUPPORTED_CHAIN_IDS) {
      try {
        const client = evmConfig.getPublicClient(chainId);
        this.clients.set(chainId, client);
        log.info({ chainId, msg: 'Initialized RPC client' });
      } catch {
        log.debug({ chainId, msg: 'Chain not configured, skipping' });
      }
    }
  }

  /**
   * Load active subscriptions from database.
   */
  private async loadActiveSubscriptions(): Promise<void> {
    priceLog.methodEntry(log, 'loadActiveSubscriptions');

    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
        state: true,
      },
    });

    log.info({ subscriptionCount: subscriptions.length, msg: 'Loaded active balance subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20BalanceSubscriptionConfig;

      if (!config.chainId || !config.tokenAddress) {
        log.warn({ subscriptionId: sub.subscriptionId, msg: 'Subscription config missing chainId or tokenAddress' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId as SupportedChainId;

      if (!this.clients.has(chainId)) {
        log.warn({ chainId, subscriptionId: sub.subscriptionId, msg: 'No RPC client for chain, skipping subscription' });
        continue;
      }

      this.subscribedBalances.set(sub.subscriptionId, {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        chainId,
        tokenAddress: getAddress(config.tokenAddress),
        walletAddress: getAddress(config.walletAddress),
      });

      // Initialize last known balance from DB state
      const state = sub.state as unknown as Erc20BalanceSubscriptionState;
      if (state.balance) {
        this.lastKnownBalances.set(sub.subscriptionId, state.balance);
      }
    }

    // Log summary per chain
    const byChain = new Map<SupportedChainId, number>();
    for (const sub of this.subscribedBalances.values()) {
      byChain.set(sub.chainId, (byChain.get(sub.chainId) || 0) + 1);
    }
    for (const [chainId, count] of byChain) {
      log.info({ chainId, balanceCount: count, msg: 'Balances grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');
  }

  // ===========================================================================
  // Balance Polling (multicall)
  // ===========================================================================

  /**
   * Start the balance polling timer.
   */
  private startBalancePolling(): void {
    this.balancePollTimer = setInterval(() => {
      this.pollBalances().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling balances',
        });
      });
    }, BALANCE_POLL_INTERVAL_MS);

    log.info({ intervalMs: BALANCE_POLL_INTERVAL_MS, msg: 'Started balance polling (multicall)' });
  }

  /**
   * Stop the balance polling timer.
   */
  private stopBalancePolling(): void {
    if (this.balancePollTimer) {
      clearInterval(this.balancePollTimer);
      this.balancePollTimer = null;
      log.info({ msg: 'Stopped balance polling' });
    }
  }

  /**
   * Poll all active subscriptions via multicall.
   * Deduplicates by (chainId, tokenAddress, walletAddress) so identical pairs
   * produce only one RPC read, with results fanned out to all matching subscriptions.
   */
  private async pollBalances(): Promise<void> {
    if (this.subscribedBalances.size === 0) {
      return;
    }

    // Group subscriptions by chain
    const byChain = new Map<SupportedChainId, BalanceSubscriptionInfo[]>();
    for (const sub of this.subscribedBalances.values()) {
      const chain = byChain.get(sub.chainId) || [];
      chain.push(sub);
      byChain.set(sub.chainId, chain);
    }

    for (const [chainId, subs] of byChain) {
      const client = this.clients.get(chainId);
      if (!client) {
        log.warn({ chainId, msg: 'No client for chain, skipping balance poll' });
        continue;
      }

      await this.pollChainBalances(client, chainId, subs);
    }
  }

  /**
   * Poll balances for a single chain using multicall.
   * Deduplicates identical (tokenAddress, walletAddress) pairs.
   */
  private async pollChainBalances(
    client: PublicClient,
    chainId: SupportedChainId,
    subs: BalanceSubscriptionInfo[]
  ): Promise<void> {
    // Deduplicate by (tokenAddress, walletAddress) — key is "token:wallet"
    const uniqueKeys = new Map<string, { tokenAddress: string; walletAddress: string }>();
    const keyToSubs = new Map<string, BalanceSubscriptionInfo[]>();

    for (const sub of subs) {
      const key = `${sub.tokenAddress}:${sub.walletAddress}`;
      if (!uniqueKeys.has(key)) {
        uniqueKeys.set(key, { tokenAddress: sub.tokenAddress, walletAddress: sub.walletAddress });
        keyToSubs.set(key, []);
      }
      keyToSubs.get(key)!.push(sub);
    }

    const uniqueEntries = Array.from(uniqueKeys.entries());

    // Process in chunks of MULTICALL_BATCH_SIZE
    for (let i = 0; i < uniqueEntries.length; i += MULTICALL_BATCH_SIZE) {
      const chunk = uniqueEntries.slice(i, i + MULTICALL_BATCH_SIZE);

      const contracts = chunk.map(([, { tokenAddress, walletAddress }]) => ({
        address: tokenAddress as `0x${string}`,
        abi: balanceOfAbi,
        functionName: 'balanceOf' as const,
        args: [walletAddress as `0x${string}`],
      }));

      const results = await client.multicall({
        contracts,
        allowFailure: true,
      });

      const now = new Date();
      const nowIso = now.toISOString();

      for (let j = 0; j < results.length; j++) {
        const result = results[j]!;
        const chunkEntry = chunk[j]!;
        const key = chunkEntry[0];
        const matchingSubs = keyToSubs.get(key)!;

        if (result.status === 'failure') {
          log.warn({
            chainId,
            key,
            error: result.error?.message,
            msg: 'Multicall balanceOf failed',
          });
          continue;
        }

        const newBalance = (result.result as bigint).toString();

        // Fan out result to all subscriptions with this key
        for (const sub of matchingSubs) {
          const lastKnown = this.lastKnownBalances.get(sub.subscriptionId);

          // Only update DB if balance changed
          if (newBalance !== lastKnown) {
            this.lastKnownBalances.set(sub.subscriptionId, newBalance);

            const newState: Erc20BalanceSubscriptionState = {
              balance: newBalance,
              lastEventBlock: null,
              lastEventTxHash: null,
              lastUpdatedAt: nowIso,
            };

            await prisma.onchainDataSubscribers.update({
              where: { id: sub.id },
              data: {
                state: newState as unknown as Prisma.InputJsonValue,
                updatedAt: now,
              },
            });

            log.info({
              chainId,
              subscriptionId: sub.subscriptionId,
              tokenAddress: sub.tokenAddress,
              walletAddress: sub.walletAddress,
              balance: newBalance,
              msg: 'Updated balance state',
            });
          }
        }
      }
    }
  }

  // ===========================================================================
  // Subscription Lifecycle Management
  // ===========================================================================

  /**
   * Add a balance subscription to the worker.
   * Called when API creates a new subscription or reactivates a paused one.
   */
  addBalance(
    subscriptionId: string,
    id: string,
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): void {
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const supportedChainId = chainId as SupportedChainId;

    if (this.subscribedBalances.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Balance already subscribed' });
      return;
    }

    if (!this.clients.has(supportedChainId)) {
      throw new Error(
        `No RPC client configured for chain ${supportedChainId} (${CHAIN_NAMES[supportedChainId]}). Set RPC_URL_${CHAIN_NAMES[supportedChainId].toUpperCase()} env var.`
      );
    }

    this.subscribedBalances.set(subscriptionId, {
      id,
      subscriptionId,
      chainId: supportedChainId,
      tokenAddress: getAddress(tokenAddress),
      walletAddress: getAddress(walletAddress),
    });

    log.info({
      chainId,
      subscriptionId,
      tokenAddress,
      msg: 'Added balance subscription',
    });
  }

  /**
   * Remove a balance subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  removeBalance(subscriptionId: string): void {
    const balanceInfo = this.subscribedBalances.get(subscriptionId);
    if (!balanceInfo) {
      log.debug({ subscriptionId, msg: 'Balance not found in subscribed list' });
      return;
    }

    this.subscribedBalances.delete(subscriptionId);
    this.lastKnownBalances.delete(subscriptionId);

    log.info({
      chainId: balanceInfo.chainId,
      subscriptionId,
      msg: 'Removed balance subscription',
    });
  }

  // ===========================================================================
  // DB Polling (for new subscriptions and reactivations)
  // ===========================================================================

  /**
   * Start polling for new subscriptions.
   */
  private startDbPolling(): void {
    this.dbPollTimer = setInterval(() => {
      this.pollNewSubscriptions().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling for new subscriptions',
        });
      });
    }, DB_POLL_INTERVAL_MS);

    log.info({ intervalMs: DB_POLL_INTERVAL_MS, msg: 'Started polling for new subscriptions' });
  }

  /**
   * Stop polling.
   */
  private stopDbPolling(): void {
    if (this.dbPollTimer) {
      clearInterval(this.dbPollTimer);
      this.dbPollTimer = null;
      log.info({ msg: 'Stopped polling for new subscriptions' });
    }
  }

  /**
   * Poll database for new active subscriptions that aren't tracked yet.
   */
  private async pollNewSubscriptions(): Promise<void> {
    const subscriptions = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedBalances.keys()),
        },
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    log.info({ count: subscriptions.length, msg: 'Found new active subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20BalanceSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID, skipping' });
        continue;
      }

      if (!this.clients.has(config.chainId as SupportedChainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'No RPC client for chain, skipping subscription' });
        continue;
      }

      this.addBalance(
        sub.subscriptionId,
        sub.id,
        config.chainId,
        config.tokenAddress,
        config.walletAddress
      );
    }
  }

  // ===========================================================================
  // Cleanup (pause stale, prune deleted)
  // ===========================================================================

  /**
   * Start the cleanup timer.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Promise.all([
        this.pauseStaleSubscriptions(),
        this.pruneDeletedSubscriptions(),
      ]).catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error during cleanup',
        });
      });
    }, CLEANUP_INTERVAL_MS);

    log.info({
      intervalMs: CLEANUP_INTERVAL_MS,
      pauseThresholdMs: PAUSE_THRESHOLD_MS,
      pruneThresholdMs: PRUNE_THRESHOLD_MS,
      msg: 'Started cleanup timer',
    });
  }

  /**
   * Stop the cleanup timer.
   */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      log.info({ msg: 'Stopped cleanup timer' });
    }
  }

  /**
   * Pause subscriptions that haven't been polled within their expiry window.
   * Removes them from the polling loop but keeps the DB record.
   */
  private async pauseStaleSubscriptions(): Promise<void> {
    const candidates = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'active',
        expiresAfterMs: { not: null },
      },
      select: {
        id: true,
        subscriptionId: true,
        lastPolledAt: true,
        expiresAfterMs: true,
      },
    });

    const now = Date.now();
    const staleSubscriptions = candidates.filter((sub) => {
      if (!sub.lastPolledAt || sub.expiresAfterMs == null) return false;
      return now - sub.lastPolledAt.getTime() > sub.expiresAfterMs;
    });

    if (staleSubscriptions.length === 0) {
      return;
    }

    log.info({ count: staleSubscriptions.length, msg: 'Pausing stale subscriptions' });

    const pausedAt = new Date();

    for (const sub of staleSubscriptions) {
      await prisma.onchainDataSubscribers.update({
        where: { id: sub.id },
        data: {
          status: 'paused',
          pausedAt,
        },
      });

      this.removeBalance(sub.subscriptionId);

      log.info({ subscriptionId: sub.subscriptionId, msg: 'Paused stale subscription' });
    }
  }

  /**
   * Delete subscriptions that have been paused for longer than PRUNE_THRESHOLD_MS.
   */
  private async pruneDeletedSubscriptions(): Promise<void> {
    const cutoffTime = new Date(Date.now() - PRUNE_THRESHOLD_MS);

    const toDelete = await prisma.onchainDataSubscribers.findMany({
      where: {
        subscriptionType: 'erc20-balance',
        status: 'paused',
        pausedAt: {
          lt: cutoffTime,
        },
      },
      select: {
        id: true,
        subscriptionId: true,
      },
    });

    if (toDelete.length === 0) {
      return;
    }

    log.info({ count: toDelete.length, msg: 'Pruning old paused subscriptions' });

    const subscriptionIds = toDelete.map((sub) => sub.subscriptionId);

    await prisma.onchainDataSubscribers.deleteMany({
      where: {
        subscriptionId: { in: subscriptionIds },
      },
    });

    log.info({ count: toDelete.length, msg: 'Pruned paused subscriptions' });
  }
}
