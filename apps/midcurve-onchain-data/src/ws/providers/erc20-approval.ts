/**
 * ERC-20 Approval WebSocket Provider
 *
 * Subscribes to Approval events from ERC-20 tokens using eth_subscribe.
 * Updates approval state in the database when events are received.
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
} from 'viem';
import { onchainDataLogger, priceLog } from '../../lib/logger.js';
import { prisma, Prisma } from '@midcurve/database';
import type { SupportedChainId } from '../../lib/config.js';
import type { Erc20ApprovalSubscriptionState } from '@midcurve/shared';

const log = onchainDataLogger.child({ component: 'Erc20ApprovalProvider' });

/** Maximum tokens per WebSocket subscription (eth_subscribe limit) */
export const MAX_TOKENS_PER_SUBSCRIPTION = 1000;

/**
 * ERC-20 Approval event signature.
 * Approval(address indexed owner, address indexed spender, uint256 value)
 */
export const APPROVAL_EVENT_TOPIC = keccak256(
  toHex('Approval(address,address,uint256)')
);

/**
 * Approval subscription info for tracking.
 */
export interface ApprovalInfo {
  /** Database row ID */
  id: string;
  /** Unique subscription ID for API polling */
  subscriptionId: string;
  /** ERC-20 token contract address (normalized) */
  tokenAddress: string;
  /** Owner address who grants approval (normalized) */
  ownerAddress: string;
  /** Spender address (normalized) */
  spenderAddress: string;
}

/**
 * ERC-20 Approval subscription batch for a single chain.
 * Each batch handles up to MAX_TOKENS_PER_SUBSCRIPTION tokens.
 */
export class Erc20ApprovalSubscriptionBatch {
  private readonly chainId: SupportedChainId;
  private readonly wssUrl: string;
  private readonly batchIndex: number;
  // Map: tokenAddress -> ApprovalInfo[]
  // Multiple subscriptions can exist for the same token (different owner/spender pairs)
  private approvals: Map<string, ApprovalInfo[]>;
  private client: PublicClient | null = null;
  private unwatch: WatchEventReturnType | null = null;
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelayMs = 5000;

  constructor(
    chainId: SupportedChainId,
    wssUrl: string,
    batchIndex: number,
    approvals: ApprovalInfo[]
  ) {
    this.chainId = chainId;
    this.wssUrl = wssUrl;
    this.batchIndex = batchIndex;
    this.approvals = new Map();

    // Group approvals by token address
    for (const approval of approvals) {
      const tokenAddr = approval.tokenAddress.toLowerCase();
      const existing = this.approvals.get(tokenAddr) || [];
      existing.push(approval);
      this.approvals.set(tokenAddr, existing);
    }

    // Check total subscription count (unique subscriptions, not unique tokens)
    const totalSubscriptions = approvals.length;
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
    for (const infos of this.approvals.values()) {
      count += infos.length;
    }
    return count;
  }

  /**
   * Add an approval subscription to this batch dynamically.
   * Reconnects the WebSocket to include the new token in the filter.
   */
  async addApproval(approval: ApprovalInfo): Promise<void> {
    const tokenAddr = approval.tokenAddress.toLowerCase();

    // Check if this exact subscription already exists
    const existing = this.approvals.get(tokenAddr) || [];
    const alreadyExists = existing.some(
      (a) =>
        a.ownerAddress.toLowerCase() === approval.ownerAddress.toLowerCase() &&
        a.spenderAddress.toLowerCase() === approval.spenderAddress.toLowerCase()
    );

    if (alreadyExists) {
      log.debug({
        subscriptionId: approval.subscriptionId,
        msg: 'Approval subscription already in batch, skipping',
      });
      return;
    }

    // Check batch capacity
    if (this.subscriptionCount >= MAX_TOKENS_PER_SUBSCRIPTION) {
      throw new Error(
        `Batch at max capacity: ${this.subscriptionCount} >= ${MAX_TOKENS_PER_SUBSCRIPTION}`
      );
    }

    // Add to approvals map
    existing.push(approval);
    this.approvals.set(tokenAddr, existing);

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId: approval.subscriptionId,
      tokenAddress: approval.tokenAddress,
      newSubscriptionCount: this.subscriptionCount,
      msg: 'Added approval to batch',
    });

    // Reconnect to update the subscription filter if this is a new token address
    // (WebSocket filter is by token address, not owner/spender)
    const needsReconnect = existing.length === 1; // First subscription for this token
    if (this.isRunning && needsReconnect) {
      await this.reconnect();
    }
  }

  /**
   * Check if this batch contains a subscription.
   */
  hasApproval(subscriptionId: string): boolean {
    for (const infos of this.approvals.values()) {
      if (infos.some((a) => a.subscriptionId === subscriptionId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all token addresses in this batch.
   */
  getTokenAddresses(): string[] {
    return Array.from(this.approvals.keys());
  }

  /**
   * Get approval info by subscription ID.
   */
  getApprovalInfo(subscriptionId: string): ApprovalInfo | undefined {
    for (const infos of this.approvals.values()) {
      const found = infos.find((a) => a.subscriptionId === subscriptionId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Remove an approval subscription from this batch.
   * Reconnects the WebSocket to update the filter if this was the last subscription for the token.
   */
  async removeApproval(subscriptionId: string): Promise<void> {
    let tokenAddrToRemove: string | null = null;
    let needsReconnect = false;

    for (const [tokenAddr, infos] of this.approvals.entries()) {
      const index = infos.findIndex((a) => a.subscriptionId === subscriptionId);
      if (index !== -1) {
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
      this.approvals.delete(tokenAddrToRemove);
    }

    log.info({
      chainId: this.chainId,
      batchIndex: this.batchIndex,
      subscriptionId,
      remainingSubscriptionCount: this.subscriptionCount,
      msg: 'Removed approval from batch',
    });

    // Reconnect to update the subscription filter (if still running and has tokens)
    if (this.isRunning && needsReconnect && this.approvals.size > 0) {
      await this.reconnect();
    } else if (this.isRunning && this.approvals.size === 0) {
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
    this.client = null;

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

    // Note: viem's WebSocket client doesn't expose a direct close method
    // Setting client to null allows garbage collection
    this.client = null;

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
      tokenCount: this.approvals.size,
      subscriptionCount: this.subscriptionCount,
      isConnected: this.client !== null && this.unwatch !== null,
      isRunning: this.isRunning,
    };
  }

  /**
   * Connect to WebSocket and subscribe to events.
   */
  private async connect(): Promise<void> {
    priceLog.wsConnection(log, this.chainId, 'connecting', {
      batchIndex: this.batchIndex,
      tokenCount: this.approvals.size,
      subscriptionCount: this.subscriptionCount,
    });

    try {
      // Create viem client with WebSocket transport
      this.client = createPublicClient({
        transport: webSocket(this.wssUrl, {
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      // Get token addresses for the filter
      const tokenAddresses = Array.from(this.approvals.keys()) as `0x${string}`[];

      // Subscribe to Approval events for all tokens in this batch
      // Note: We filter by token address at WebSocket level, and by owner/spender in handleLogs
      this.unwatch = this.client.watchEvent({
        address: tokenAddresses,
        event: {
          type: 'event',
          name: 'Approval',
          inputs: [
            { type: 'address', name: 'owner', indexed: true },
            { type: 'address', name: 'spender', indexed: true },
            { type: 'uint256', name: 'value', indexed: false },
          ],
        },
        onLogs: (logs) => this.handleLogs(logs),
        onError: (error) => this.handleError(error),
      });

      this.reconnectAttempts = 0;

      priceLog.wsConnection(log, this.chainId, 'connected', {
        batchIndex: this.batchIndex,
        tokenCount: this.approvals.size,
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
        args?: { owner?: string; spender?: string; value?: bigint };
      };

      const tokenAddress = logData.address?.toLowerCase() || '';
      const blockNumber = logData.blockNumber ? Number(logData.blockNumber) : null;
      const txHash = logData.transactionHash || null;
      const removed = logData.removed || false;
      const owner = logData.args?.owner?.toLowerCase() || '';
      const spender = logData.args?.spender?.toLowerCase() || '';
      const value = logData.args?.value ?? 0n;

      log.debug({
        chainId: this.chainId,
        tokenAddress,
        owner,
        spender,
        value: value.toString(),
        blockNumber,
        removed,
        msg: `Approval event: ${tokenAddress}`,
      });

      // Skip removed (reorg) events
      if (removed) {
        log.debug({
          chainId: this.chainId,
          tokenAddress,
          msg: 'Skipping removed (reorg) approval event',
        });
        continue;
      }

      // Find matching subscriptions for this token/owner/spender
      const tokenSubscriptions = this.approvals.get(tokenAddress) || [];
      const matchingSubs = tokenSubscriptions.filter(
        (sub) =>
          sub.ownerAddress.toLowerCase() === owner &&
          sub.spenderAddress.toLowerCase() === spender
      );

      // Update database for each matching subscription
      for (const sub of matchingSubs) {
        this.updateApprovalState(sub, value, blockNumber, txHash).catch((err) => {
          log.error({
            error: err instanceof Error ? err.message : String(err),
            chainId: this.chainId,
            subscriptionId: sub.subscriptionId,
            msg: 'Failed to update approval state',
          });
        });
      }
    }
  }

  /**
   * Update approval state in the database.
   */
  private async updateApprovalState(
    approval: ApprovalInfo,
    value: bigint,
    blockNumber: number | null,
    txHash: string | null
  ): Promise<void> {
    const now = new Date();

    // Get current state
    const subscription = await prisma.onchainDataSubscribers.findUnique({
      where: { id: approval.id },
    });

    if (!subscription || subscription.status === 'deleted') {
      log.warn({
        subscriptionId: approval.subscriptionId,
        msg: 'Subscription not found or deleted, skipping update',
      });
      return;
    }

    const currentState = subscription.state as unknown as Erc20ApprovalSubscriptionState;

    // Only update if this event is newer (by block number)
    if (
      currentState.lastEventBlock !== null &&
      blockNumber !== null &&
      blockNumber < currentState.lastEventBlock
    ) {
      log.debug({
        subscriptionId: approval.subscriptionId,
        currentBlock: currentState.lastEventBlock,
        eventBlock: blockNumber,
        msg: 'Skipping older event',
      });
      return;
    }

    const newState: Erc20ApprovalSubscriptionState = {
      approvalAmount: value.toString(),
      lastEventBlock: blockNumber,
      lastEventTxHash: txHash,
      lastUpdatedAt: now.toISOString(),
    };

    await prisma.onchainDataSubscribers.update({
      where: { id: approval.id },
      data: {
        state: newState as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    log.info({
      chainId: this.chainId,
      subscriptionId: approval.subscriptionId,
      tokenAddress: approval.tokenAddress,
      approvalAmount: value.toString(),
      blockNumber,
      msg: 'Updated approval state',
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
    this.client = null;

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
 * Splits approvals into batches of MAX_TOKENS_PER_SUBSCRIPTION.
 */
export function createApprovalSubscriptionBatches(
  chainId: SupportedChainId,
  wssUrl: string,
  approvals: ApprovalInfo[]
): Erc20ApprovalSubscriptionBatch[] {
  const batches: Erc20ApprovalSubscriptionBatch[] = [];

  for (let i = 0; i < approvals.length; i += MAX_TOKENS_PER_SUBSCRIPTION) {
    const batchApprovals = approvals.slice(i, i + MAX_TOKENS_PER_SUBSCRIPTION);
    const batchIndex = Math.floor(i / MAX_TOKENS_PER_SUBSCRIPTION);

    batches.push(
      new Erc20ApprovalSubscriptionBatch(chainId, wssUrl, batchIndex, batchApprovals)
    );
  }

  log.info({
    chainId,
    totalApprovals: approvals.length,
    batchCount: batches.length,
    msg: `Created ${batches.length} approval subscription batches`,
  });

  return batches;
}
