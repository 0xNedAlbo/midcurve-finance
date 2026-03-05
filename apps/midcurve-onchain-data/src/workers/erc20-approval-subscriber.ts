/**
 * Erc20ApprovalSubscriber Worker
 *
 * Polls ERC-20 token allowances using multicall for all active subscriptions.
 * Replaces the previous WebSocket-based approach that subscribed to Approval
 * events. Multicall batches all allowance() reads into a single RPC call per
 * chain, deduplicating identical (token, owner, spender) tuples.
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
  getChainName,
  SUPPORTED_CHAIN_IDS,
} from '../lib/config.js';
import type {
  Erc20ApprovalSubscriptionConfig,
  Erc20ApprovalSubscriptionState,
} from '@midcurve/shared';
import { getEvmConfig } from '@midcurve/services';
import { type PublicClient, getAddress } from 'viem';

const log = onchainDataLogger.child({ component: 'Erc20ApprovalSubscriber' });

/** Threshold for pausing subscriptions (default: 60 seconds) */
const PAUSE_THRESHOLD_MS = parseInt(process.env.APPROVAL_STALE_THRESHOLD_MS || '60000', 10);

/** Threshold for deleting paused subscriptions (default: 5 minutes) */
const PRUNE_THRESHOLD_MS = parseInt(process.env.APPROVAL_PRUNE_THRESHOLD_MS || '300000', 10);

/** Interval for checking stale subscriptions (default: 30 seconds) */
const CLEANUP_INTERVAL_MS = parseInt(process.env.APPROVAL_CLEANUP_INTERVAL_MS || '30000', 10);

/** Interval for polling DB for new subscriptions (default: 5 seconds) */
const DB_POLL_INTERVAL_MS = parseInt(process.env.APPROVAL_POLL_INTERVAL_MS || '5000', 10);

/** Interval for polling allowances via multicall (default: 5 seconds) */
const APPROVAL_POLL_INTERVAL_MS = parseInt(process.env.APPROVAL_MULTICALL_INTERVAL_MS || '5000', 10);

/** Maximum allowance calls per multicall request */
const MULTICALL_BATCH_SIZE = parseInt(process.env.APPROVAL_MULTICALL_BATCH_SIZE || '256', 10);

/** ERC-20 allowance ABI */
const allowanceAbi = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Approval subscription info for tracking.
 */
interface ApprovalSubscriptionInfo {
  /** Database row ID */
  id: string;
  /** Unique subscription ID for API polling */
  subscriptionId: string;
  /** Chain ID */
  chainId: number;
  /** ERC-20 token contract address (checksummed) */
  tokenAddress: string;
  /** Owner address (checksummed) */
  ownerAddress: string;
  /** Spender address (checksummed) */
  spenderAddress: string;
}

/**
 * Erc20ApprovalSubscriber polls ERC-20 allowances via multicall.
 * Subscriptions are created via the API and managed by this worker.
 */
export class Erc20ApprovalSubscriber {
  private isRunning = false;

  // Track subscribed approvals by subscriptionId
  private subscribedApprovals: Map<string, ApprovalSubscriptionInfo> = new Map();

  // In-memory cache of last known allowance per subscriptionId (avoids unnecessary DB writes)
  private lastKnownAllowances: Map<string, string> = new Map();

  // HTTP RPC clients per chain
  private clients: Map<number, PublicClient> = new Map();

  // Timers
  private approvalPollTimer: NodeJS.Timeout | null = null;
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

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'starting');

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

    // Start approval polling (multicall)
    this.startApprovalPolling();

    // Start DB polling (discover new subscriptions)
    this.startDbPolling();

    // Start cleanup timer (pause stale, prune deleted)
    this.startCleanup();

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'started', {
      subscriptionCount: this.subscribedApprovals.size,
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

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'stopping');

    // Stop timers
    this.stopApprovalPolling();
    this.stopDbPolling();
    this.stopCleanup();

    // Clear state
    this.subscribedApprovals.clear();
    this.lastKnownAllowances.clear();
    this.clients.clear();
    this.isRunning = false;

    priceLog.workerLifecycle(log, 'Erc20ApprovalSubscriber', 'stopped');
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
    for (const sub of this.subscribedApprovals.values()) {
      subscriptionsByChain[sub.chainId] = (subscriptionsByChain[sub.chainId] || 0) + 1;
    }

    return {
      isRunning: this.isRunning,
      subscriptionCount: this.subscribedApprovals.size,
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
        subscriptionType: 'erc20-approval',
        status: 'active',
      },
      select: {
        id: true,
        subscriptionId: true,
        config: true,
        state: true,
      },
    });

    log.info({ subscriptionCount: subscriptions.length, msg: 'Loaded active approval subscriptions' });

    for (const sub of subscriptions) {
      const config = sub.config as unknown as Erc20ApprovalSubscriptionConfig;

      if (!config.chainId || !config.tokenAddress) {
        log.warn({ subscriptionId: sub.subscriptionId, msg: 'Subscription config missing chainId or tokenAddress' });
        continue;
      }

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID' });
        continue;
      }

      const chainId = config.chainId;

      if (!this.clients.has(chainId)) {
        log.warn({ chainId, subscriptionId: sub.subscriptionId, msg: 'No RPC client for chain, skipping subscription' });
        continue;
      }

      this.subscribedApprovals.set(sub.subscriptionId, {
        id: sub.id,
        subscriptionId: sub.subscriptionId,
        chainId,
        tokenAddress: getAddress(config.tokenAddress),
        ownerAddress: getAddress(config.walletAddress),
        spenderAddress: getAddress(config.spenderAddress),
      });

      // Initialize last known allowance from DB state
      const state = sub.state as unknown as Erc20ApprovalSubscriptionState;
      if (state.approvalAmount) {
        this.lastKnownAllowances.set(sub.subscriptionId, state.approvalAmount);
      }
    }

    // Log summary per chain
    const byChain = new Map<number, number>();
    for (const sub of this.subscribedApprovals.values()) {
      byChain.set(sub.chainId, (byChain.get(sub.chainId) || 0) + 1);
    }
    for (const [chainId, count] of byChain) {
      log.info({ chainId, approvalCount: count, msg: 'Approvals grouped by chain' });
    }

    priceLog.methodExit(log, 'loadActiveSubscriptions');
  }

  // ===========================================================================
  // Approval Polling (multicall)
  // ===========================================================================

  /**
   * Start the approval polling timer.
   */
  private startApprovalPolling(): void {
    this.approvalPollTimer = setInterval(() => {
      this.pollApprovals().catch((err) => {
        log.error({
          error: err instanceof Error ? err.message : String(err),
          msg: 'Error polling approvals',
        });
      });
    }, APPROVAL_POLL_INTERVAL_MS);

    log.info({ intervalMs: APPROVAL_POLL_INTERVAL_MS, msg: 'Started approval polling (multicall)' });
  }

  /**
   * Stop the approval polling timer.
   */
  private stopApprovalPolling(): void {
    if (this.approvalPollTimer) {
      clearInterval(this.approvalPollTimer);
      this.approvalPollTimer = null;
      log.info({ msg: 'Stopped approval polling' });
    }
  }

  /**
   * Poll all active subscriptions via multicall.
   * Deduplicates by (chainId, tokenAddress, ownerAddress, spenderAddress) so identical
   * tuples produce only one RPC read, with results fanned out to all matching subscriptions.
   */
  private async pollApprovals(): Promise<void> {
    if (this.subscribedApprovals.size === 0) {
      return;
    }

    // Group subscriptions by chain
    const byChain = new Map<number, ApprovalSubscriptionInfo[]>();
    for (const sub of this.subscribedApprovals.values()) {
      const chain = byChain.get(sub.chainId) || [];
      chain.push(sub);
      byChain.set(sub.chainId, chain);
    }

    for (const [chainId, subs] of byChain) {
      const client = this.clients.get(chainId);
      if (!client) {
        log.warn({ chainId, msg: 'No client for chain, skipping approval poll' });
        continue;
      }

      await this.pollChainApprovals(client, chainId, subs);
    }
  }

  /**
   * Poll approvals for a single chain using multicall.
   * Deduplicates identical (tokenAddress, ownerAddress, spenderAddress) tuples.
   */
  private async pollChainApprovals(
    client: PublicClient,
    chainId: number,
    subs: ApprovalSubscriptionInfo[]
  ): Promise<void> {
    // Deduplicate by (tokenAddress, ownerAddress, spenderAddress) — key is "token:owner:spender"
    const uniqueKeys = new Map<string, { tokenAddress: string; ownerAddress: string; spenderAddress: string }>();
    const keyToSubs = new Map<string, ApprovalSubscriptionInfo[]>();

    for (const sub of subs) {
      const key = `${sub.tokenAddress}:${sub.ownerAddress}:${sub.spenderAddress}`;
      if (!uniqueKeys.has(key)) {
        uniqueKeys.set(key, { tokenAddress: sub.tokenAddress, ownerAddress: sub.ownerAddress, spenderAddress: sub.spenderAddress });
        keyToSubs.set(key, []);
      }
      keyToSubs.get(key)!.push(sub);
    }

    const uniqueEntries = Array.from(uniqueKeys.entries());

    // Process in chunks of MULTICALL_BATCH_SIZE
    for (let i = 0; i < uniqueEntries.length; i += MULTICALL_BATCH_SIZE) {
      const chunk = uniqueEntries.slice(i, i + MULTICALL_BATCH_SIZE);

      const contracts = chunk.map(([, { tokenAddress, ownerAddress, spenderAddress }]) => ({
        address: tokenAddress as `0x${string}`,
        abi: allowanceAbi,
        functionName: 'allowance' as const,
        args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
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
            msg: 'Multicall allowance failed',
          });
          continue;
        }

        const newAllowance = (result.result as bigint).toString();

        // Fan out result to all subscriptions with this key
        for (const sub of matchingSubs) {
          const lastKnown = this.lastKnownAllowances.get(sub.subscriptionId);

          // Only update DB if allowance changed
          if (newAllowance !== lastKnown) {
            this.lastKnownAllowances.set(sub.subscriptionId, newAllowance);

            const newState: Erc20ApprovalSubscriptionState = {
              approvalAmount: newAllowance,
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
              ownerAddress: sub.ownerAddress,
              spenderAddress: sub.spenderAddress,
              allowance: newAllowance,
              msg: 'Updated approval state',
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
   * Add an approval subscription to the worker.
   * Called when API creates a new subscription or reactivates a paused one.
   */
  addApproval(
    subscriptionId: string,
    id: string,
    chainId: number,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string
  ): void {
    if (!isSupportedChain(chainId)) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    if (this.subscribedApprovals.has(subscriptionId)) {
      log.debug({ subscriptionId, msg: 'Approval already subscribed' });
      return;
    }

    if (!this.clients.has(chainId)) {
      throw new Error(
        `No RPC client configured for chain ${chainId} (${getChainName(chainId)}). Set RPC_URL_${getChainName(chainId).toUpperCase()} env var.`
      );
    }

    this.subscribedApprovals.set(subscriptionId, {
      id,
      subscriptionId,
      chainId,
      tokenAddress: getAddress(tokenAddress),
      ownerAddress: getAddress(ownerAddress),
      spenderAddress: getAddress(spenderAddress),
    });

    log.info({
      chainId,
      subscriptionId,
      tokenAddress,
      msg: 'Added approval subscription',
    });
  }

  /**
   * Remove an approval subscription from the worker.
   * Called when subscription is paused or deleted.
   */
  removeApproval(subscriptionId: string): void {
    const approvalInfo = this.subscribedApprovals.get(subscriptionId);
    if (!approvalInfo) {
      log.debug({ subscriptionId, msg: 'Approval not found in subscribed list' });
      return;
    }

    this.subscribedApprovals.delete(subscriptionId);
    this.lastKnownAllowances.delete(subscriptionId);

    log.info({
      chainId: approvalInfo.chainId,
      subscriptionId,
      msg: 'Removed approval subscription',
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
        subscriptionType: 'erc20-approval',
        status: 'active',
        subscriptionId: {
          notIn: Array.from(this.subscribedApprovals.keys()),
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
      const config = sub.config as unknown as Erc20ApprovalSubscriptionConfig;

      if (!isSupportedChain(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'Unsupported chain ID, skipping' });
        continue;
      }

      if (!this.clients.has(config.chainId)) {
        log.warn({ chainId: config.chainId, subscriptionId: sub.subscriptionId, msg: 'No RPC client for chain, skipping subscription' });
        continue;
      }

      this.addApproval(
        sub.subscriptionId,
        sub.id,
        config.chainId,
        config.tokenAddress,
        config.walletAddress,
        config.spenderAddress
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
        subscriptionType: 'erc20-approval',
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

      this.removeApproval(sub.subscriptionId);

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
        subscriptionType: 'erc20-approval',
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
