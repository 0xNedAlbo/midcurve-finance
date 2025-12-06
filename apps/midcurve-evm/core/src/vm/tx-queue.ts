/**
 * Transaction Queue with Nonce Management
 *
 * Manages nonces for the Core account to enable parallel transaction sending.
 * Instead of waiting for each transaction to be mined before sending the next,
 * this queue assigns nonces sequentially and sends transactions immediately.
 *
 * Flow:
 * 1. Transaction comes in → assigned next nonce → sent immediately
 * 2. Multiple transactions can be in-flight simultaneously
 * 3. Receipts are waited for in parallel
 *
 * This is much faster than waiting for each tx to be mined (~4s) before
 * sending the next one. With 7 subscribers, sequential mining takes ~28s
 * while parallel sending takes ~4s total.
 */

import type { Address, Hex, PublicClient } from 'viem';
import type { CallResult } from './types.js';

/**
 * Function that sends a transaction with an explicit nonce
 */
export type TransactionSender = (
  to: Address,
  data: Hex,
  gasLimit: bigint,
  nonce: number
) => Promise<CallResult>;

/**
 * TxQueue manages nonces to enable parallel transaction sending.
 *
 * Usage:
 * ```typescript
 * const txQueue = new TxQueue(sender, publicClient, coreAddress);
 * await txQueue.initialize();
 *
 * // These run in parallel - different nonces assigned to each
 * const [result1, result2] = await Promise.all([
 *   txQueue.enqueue(addr1, data1, gas),
 *   txQueue.enqueue(addr2, data2, gas),
 * ]);
 * ```
 */
export class TxQueue {
  private currentNonce: number = 0;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private pendingTxCount = 0;

  constructor(
    private sender: TransactionSender,
    private publicClient: PublicClient,
    private accountAddress: Address
  ) {}

  /**
   * Initialize the queue by fetching the current nonce from the network.
   * Safe to call multiple times - only initializes once.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure only one initialization runs
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // Get current nonce from the network
    const nonce = await this.publicClient.getTransactionCount({
      address: this.accountAddress,
      blockTag: 'pending', // Include pending transactions
    });

    this.currentNonce = nonce;
    this.initialized = true;
  }

  /**
   * Enqueue a transaction for execution.
   * Transactions are sent immediately with an assigned nonce.
   * Returns a promise that resolves when the transaction is mined.
   */
  async enqueue(to: Address, data: Hex, gasLimit: bigint): Promise<CallResult> {
    // Ensure initialized
    await this.initialize();

    // Assign nonce atomically (synchronous operation)
    const nonce = this.currentNonce++;
    this.pendingTxCount++;

    try {
      // Send transaction immediately with assigned nonce
      // The sender handles both sending and waiting for receipt
      const result = await this.sender(to, data, gasLimit, nonce);
      return result;
    } finally {
      this.pendingTxCount--;
    }
  }

  /**
   * Get the number of pending (in-flight) transactions
   */
  get pendingCount(): number {
    return this.pendingTxCount;
  }

  /**
   * Get the next nonce that will be assigned
   */
  get nextNonce(): number {
    return this.currentNonce;
  }

  /**
   * Check if the queue is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the nonce from the network.
   * Useful if transactions fail and nonce gets out of sync.
   */
  async resetNonce(): Promise<void> {
    const nonce = await this.publicClient.getTransactionCount({
      address: this.accountAddress,
      blockTag: 'pending',
    });
    this.currentNonce = nonce;
  }
}
