/**
 * ERC-20 Balance WebSocket Provider
 *
 * Subscribes to Transfer events from ERC-20 tokens using eth_subscribe.
 * Updates balance state in the database when events are received.
 *
 * Key difference from approval: Transfer events don't give final balance,
 * so we must call balanceOf() via RPC after each event.
 *
 * Key constraint: eth_subscribe supports max 1000 addresses per filter.
 * Each instance handles one batch of up to 1000 tokens on a single chain.
 */

import {
  createPublicClient,
  webSocket,
  type PublicClient,
  type WatchEventReturnType,
  keccak256,
  toHex,
  getAddress,
} from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger.js';
import { prisma, Prisma } from '@midcurve/database';
import type { SupportedChainId } from '../../lib/config.js';
import type { Erc20BalanceSubscriptionState } from '@midcurve/shared';
import { getEvmConfig } from '@midcurve/services';

const log = onchainDataLogger.child({ component: 'Erc20BalanceProvider' });

/** Maximum tokens per WebSocket subscription (eth_subscribe limit) */
export const MAX_TOKENS_PER_SUBSCRIPTION = 1000;

/**
 * ERC-20 Transfer event signature.
 * Transfer(address indexed from, address indexed to, uint256 value)
 */
export const TRANSFER_EVENT_TOPIC = keccak256(
  toHex('Transfer(address,address,uint256)')
);

/**
 * Balance subscription info for tracking.
 */
export interface BalanceInfo {
  /** Database row ID */
  id: string;
  /** Unique subscription ID for API polling */
  subscriptionId: string;
  /** ERC-20 token contract address (normalized) */
  tokenAddress: string;
  /** Wallet address to track balance for (normalized) */
  walletAddress: string;
}

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
 * ERC-20 Balance subscription batch for a single chain.
 * Each batch handles up to MAX_TOKENS_PER_SUBSCRIPTION tokens.
 */
export class Erc20BalanceSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  // Map: tokenAddress -> BalanceInfo[]
  // Multiple subscriptions can exist for the same token (different wallets)
  private balances: Map<string, BalanceInfo[]>;
  // Map: walletAddress -> Set of subscriptionIds
  // Used for fast lookup when filtering Transfer events
  private walletSubscriptions: Map<string, Set<string>>;
  private wsClient: PublicClient | null = null;
  private httpClient: PublicClient | null = null;
  private unwatch: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    balances: BalanceInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.balances = new Map();
    this.walletSubscriptions = new Map();

    // Group balances by token address and track wallet subscriptions
    for (const balance of balances) {
      const tokenAddr = balance.tokenAddress.toLowerCase();
      const walletAddr = balance.walletAddress.toLowerCase();

      // Group by token
      const existing = this.balances.get(tokenAddr) || [];
      existing.push(balance);
      this.balances.set(tokenAddr, existing);

      // Track wallet subscriptions
      const walletSubs = this.walletSubscriptions.get(walletAddr) || new Set();
      walletSubs.add(balance.subscriptionId);
      this.walletSubscriptions.set(walletAddr, walletSubs);
    }

    // Check total subscription count
    const totalSubscriptions = balances.length;
    if (totalSubscriptions > MAX_TOKENS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch exceeds max subscriptions: ${totalSubscriptions} > ${MAX_TOKENS_PER_SUBSCRIPTION}`
      );
    }
  }

  /**
   * Get total number of subscriptions in this batch.
   */
  get subscriptionCount(): number {
    let count = 0;
    for (const infos of this.balances.values()) {
      count += infos.length;
    }
    return count;
  }

  /**
   * Add a balance subscription to this batch dynamically.
   * Reconnects the WebSocket to include the new token in the filter.
   */
  async addBalance(balance: BalanceInfo): Promise<void> {
    const tokenAddr = balance.tokenAddress.toLowerCase();
    const walletAddr = balance.walletAddress.toLowerCase();

    // Check if this exact subscription already exists
    const existing = this.balances.get(tokenAddr) || [];
    const alreadyExists = existing.some(
      (b) => b.walletAddress.toLowerCase() === walletAddr
    );

    if (alreadyExists) {
      log.debug({
        subscriptionId: balance.subscriptionId,
        msg: 'Balance subscription already in batch, skipping',
      });
      return;
    }

    // Check batch capacity
    if (this.subscriptionCount >= MAX_TOKENS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch at max capacity: ${this.subscriptionCount} >= ${MAX_TOKENS_PER_SUBSCRIPTION}`
      );
    }

    // Add to balances map
    existing.push(balance);
    this.balances.set(tokenAddr, existing);

    // Track wallet subscription
    const walletSubs = this.walletSubscriptions.get(walletAddr) || new Set();
    walletSubs.add(balance.subscriptionId);
    this.walletSubscriptions.set(walletAddr, walletSubs);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId: balance.subscriptionId,
      tokenAddress: balance.tokenAddress,
      newSubscriptionCount: this.subscriptionCount,
      msg: 'Added balance to batch',
    });

    // Reconnect to update the subscription filter if this is a new token address
    const needsReconnect = existing.length === 1; // First subscription for this token
    if (this.isRunning && needsReconnect) {
      await this.reconnect();
    }
  }

  /**
   * Check if this batch contains a subscription.
   */
  hasBalance(subscriptionId: string): boolean {
    for (const infos of this.balances.values()) {
      if (infos.some((b) => b.subscriptionId === subscriptionId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all token addresses in this batch.
   */
  getTokenAddresses(): string[] {
    return Array.from(this.balances.keys());
  }

  /**
   * Get balance info by subscription ID.
   */
  getBalanceInfo(subscriptionId: string): BalanceInfo | undefined {
    for (const infos of this.balances.values()) {
      const found = infos.find((b) => b.subscriptionId === subscriptionId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Remove a balance subscription from this batch.
   * Reconnects the WebSocket to update the filter if this was the last subscription for the token.
   */
  async removeBalance(subscriptionId: string): Promise<void> {
    let tokenAddrToRemove: string | null = null;
    let needsReconnect = false;
    let removedWallet: string | null = null;

    for (const [tokenAddr, infos] of this.balances.entries()) {
      const index = infos.findIndex((b) => b.subscriptionId === subscriptionId);
      if (index !== -1) {
        const removedInfo = infos[index];
        if (removedInfo) {
          removedWallet = removedInfo.walletAddress.toLowerCase();
        }
        infos.splice(index, 1);

        // If no more subscriptions for this token, remove the key
        if (infos.length === 0) {
          tokenAddrToRemove = tokenAddr;
          needsReconnect = true;
        }
        break;
      }
    }

    if (tokenAddrToRemove) {
      this.balances.delete(tokenAddrToRemove);
    }

    // Clean up wallet tracking
    if (removedWallet) {
      const walletSubs = this.walletSubscriptions.get(removedWallet);
      if (walletSubs) {
        walletSubs.delete(subscriptionId);
        if (walletSubs.size === 0) {
          this.walletSubscriptions.delete(removedWallet);
        }
      }
    }

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId,
      remainingSubscriptionCount: this.subscriptionCount,
      msg: 'Removed balance from batch',
    });

    // Reconnect to update the subscription filter (if still running and has tokens)
    if (this.isRunning && needsReconnect && this.balances.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.balances.size === 0) {
      // Stop the batch if no subscriptions remain
      await this.stop();
      log.info({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Stopped empty batch',
      });
    }
  }

  /**
   * Reconnect the WebSocket with updated token list.
   */
  private async reconnect(): Promise<void> {
    // Stop current subscription
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
    this.wsClient = null;

    // Reconnect
    await this.connect();
  }

  /**
   * Start the subscription batch.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Batch already running',
      });
      return;
    }

    this.isRunning = true;

    // Get HTTP client for RPC calls (balanceOf) from EvmConfig
    try {
      this.httpClient = getEvmConfig().getPublicClient(this.chainId);
    } catch (error) {
      log.warn({
        chainId: this.chainId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Could not get HTTP client for chain, balance fetches will fail',
      });
    }

    await this.connect();
  }

  /**
   * Stop the subscription batch.
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }

    this.wsClient = null;
    this.httpClient = null;

    priceLog.subscription(log, this.chainId, 'unsubscribed', this.subscriptionCount, {
      batchIndex: this.batchIndex,
    });
  }

  /**
   * Get batch status.
   */
  getStatus(): {
    chainId: number;
    batchIndex: number;
    tokenCount: number;
    subscriptionCount: number;
    isConnected: boolean;
    isRunning: boolean;
  } {
    return {
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      tokenCount: this.balances.size,
      subscriptionCount: this.subscriptionCount,
      isConnected: this.wsClient !== null && this.unwatch !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Connect to WebSocket and subscribe to events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      tokenCount: this.balances.size,
      subscriptionCount: this.subscriptionCount,
    });

    try {
      // Create viem client with WebSocket transport
      this.wsClient = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      // Get token addresses for the filter
      const tokenAddresses = Array.from(this.balances.keys()) as `0x${string}`[];

      // Subscribe to Transfer events for all tokens in this batch
      // We filter by token address at WebSocket level, then by wallet in handleLogs
      this.unwatch = this.wsClient.watchEvent({
        address: tokenAddresses,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { type: 'address', name: 'from', indexed: true },
            { type: 'address', name: 'to', indexed: true },
            { type: 'uint256', name: 'value', indexed: false },
          ],
        },
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        tokenCount: this.balances.size,
        subscriptionCount: this.subscriptionCount,
      });

      priceLog.subscription(log, this.chainId, 'subscribed', this.subscriptionCount, {
        batchIndex: this.batchIndex,
      });
    } catch (error) {
      priceLog.wsConnection(log, this.chainId, 'error', {
        batchIndex: this.batchIndex,
        error: error instanceof Error ? error.message : String(error),
      });

      this.scheduleReconnect();
    }
  }

  /**
   * Handle incoming log events.
   */
  private handleLogs(logs: unknown[]): void {
    for (const rawLog of logs) {
      // Extract data from the log
      const logData = rawLog as {
        address?: string;
        blockNumber?: bigint;
        transactionHash?: string;
        removed?: boolean;
        args?: { from?: string; to?: string; value?: bigint };
      };

      const tokenAddress = logData.address?.toLowerCase() || '';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : null;
      const txHash = logData.transactionHash || null;
      const removed = logData.removed || false;
      const from = logData.args?.from?.toLowerCase() || '';
      const to = logData.args?.to?.toLowerCase() || '';

      log.debug({
        chainId: this.chainId,
        tokenAddress,
        from,
        to,
        blockNumber,
        removed,
        msg: `Transfer event: ${tokenAddress}`,
      });

      // Skip removed (reorg) events
      if (removed) {
        log.debug({
          chainId: this.chainId,
          tokenAddress,
          msg: 'Skipping removed (reorg) transfer event',
        });
        continue;
      }

      // Find matching subscriptions for this token/wallet
      // A subscription matches if the wallet is either the sender (from) or receiver (to)
      const tokenSubscriptions = this.balances.get(tokenAddress) || [];
      const matchingSubs = tokenSubscriptions.filter(
        (sub) =>
          sub.walletAddress.toLowerCase() === from ||
          sub.walletAddress.toLowerCase() === to
      );

      // Fetch balance and update database for each matching subscription
      for (const sub of matchingSubs) {
        this.fetchAndUpdateBalance(sub, blockNumber, txHash).catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            subscriptionId: sub.subscriptionId,
            msg: 'Failed to update balance state',
          });
        });
      }
    }
  }

  /**
   * Fetch current balance from RPC and update state in database.
   */
  private async fetchAndUpdateBalance(
    balance: BalanceInfo,
    blockNumber: number | null,
    txHash: string | null
  ): Promise<void> {
    if (!this.httpClient) {
      log.warn({
        subscriptionId: balance.subscriptionId,
        msg: 'No HTTP client available for balance fetch',
      });
      return;
    }

    const now = new Date();

    // Get current state
    const subscription = await prisma.onchainDataSubscribers.findUnique({
      where: { id: balance.id },
    });

    if (!subscription || subscription.status === 'deleted') {
      log.warn({
        subscriptionId: balance.subscriptionId,
        msg: 'Subscription not found or deleted, skipping update',
      });
      return;
    }

    const currentState = subscription.state as unknown as Erc20BalanceSubscriptionState;

    // Only update if this event is newer (by block number)
    if (
      currentState.lastEventBlock !== null &&
      blockNumber !== null &&
      blockNumber < currentState.lastEventBlock
    ) {
      log.debug({
        subscriptionId: balance.subscriptionId,
        currentBlock: currentState.lastEventBlock,
        eventBlock: blockNumber,
        msg: 'Skipping older event',
      });
      return;
    }

    // Fetch current balance from chain
    let currentBalance: bigint;
    try {
      currentBalance = await this.httpClient.readContract({
        address: getAddress(balance.tokenAddress),
        abi: balanceOfAbi,
        functionName: 'balanceOf',
        args: [getAddress(balance.walletAddress)],
      });
    } catch (error) {
      log.error({
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: balance.subscriptionId,
        tokenAddress: balance.tokenAddress,
        walletAddress: balance.walletAddress,
        msg: 'Failed to fetch balance from chain',
      });
      return;
    }

    const newState: Erc20BalanceSubscriptionState = {
      balance: currentBalance.toString(),
      lastEventBlock: blockNumber,
      lastEventTxHash: txHash,
      lastUpdatedAt: now.toISOString(),
    };

    await prisma.onchainDataSubscribers.update({
      where: { id: balance.id },
      data: {
        state: newState as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    log.info({
      chainId: this.chainId,
      subscriptionId: balance.subscriptionId,
      tokenAddress: balance.tokenAddress,
      walletAddress: balance.walletAddress,
      balance: currentBalance.toString(),
      blockNumber,
      msg: 'Updated balance state',
    });
  }

  /**
   * Handle WebSocket errors.
   */
  private handleError(error: Error): void {
    priceLog.wsConnection(log, this.chainId, 'error', {
      batchIndex: this.batchIndex,
      error: error.message,
    });

    // Clean up current connection
    this.unwatch = null;
    this.wsClient = null;

    // Schedule reconnect if still running
    if (this.isRunning) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.error({
        chainId: this.chainId,
        batchIndex: this.batchIndex,
        msg: 'Max reconnect attempts reached, giving up',
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelayMs * this.reconnectAttempts;

    priceLog.wsConnection(log, this.chainId, 'reconnecting', {
      batchIndex: this.batchIndex,
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
      delayMs: delay,
    });

    setTimeout(() => {
      if (this.isRunning) {
        this.connect().catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            batchIndex: this.batchIndex,
            msg: 'Reconnect failed',
          });
        });
      }
    }, delay);
  }
}

/**
 * Create subscription batches for a chain.
 * Splits balances into batches of MAX_TOKENS_PER_SUBSCRIPTION.
 */
export function createBalanceSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  balances: BalanceInfo[]
): Erc20BalanceSubscriptionBatch[] {
  const batches: Erc20BalanceSubscriptionBatch[] = [];

  for (let i = 0; i < balances.length; i += MAX_TOKENS_PER_SUBSCRIPTION) {
    const batchBalances = balances.slice(i, i + MAX_TOKENS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_TOKENS_PER_SUBSCRIPTION);

    batches.push(
      new Erc20BalanceSubscriptionBatch(chainId, wssUrl, batchIndex, batchBalances)
    );
  }

  log.info({
    chainId,
    totalBalances: balances.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} balance subscription batches`,
  });

  return batches;
}
