/**
 * Transaction Queue
 *
 * Serializes all blockchain transactions from the Core account to prevent
 * nonce collisions. When multiple strategies need callbacks delivered
 * simultaneously, this queue ensures transactions are sent one at a time.
 *
 * Without this, parallel mailbox processing causes nonce collisions:
 * - Strategy A's callback tries nonce 42
 * - Strategy B's callback also tries nonce 42 (before A's tx is mined)
 * - One fails with "nonce too low"
 */

import type { Address, Hex } from 'viem';
import type { CallResult } from './types.js';

export type TransactionExecutor = (
  to: Address,
  data: Hex,
  gasLimit: bigint
) => Promise<CallResult>;

interface QueuedTransaction {
  to: Address;
  data: Hex;
  gasLimit: bigint;
  resolve: (result: CallResult) => void;
  reject: (error: Error) => void;
}

/**
 * TxQueue serializes transaction execution to prevent nonce collisions.
 *
 * Usage:
 * ```typescript
 * const txQueue = new TxQueue(executor);
 *
 * // These can be called in parallel - they'll be queued internally
 * const [result1, result2] = await Promise.all([
 *   txQueue.enqueue(addr1, data1, gas),
 *   txQueue.enqueue(addr2, data2, gas),
 * ]);
 * ```
 */
export class TxQueue {
  private queue: QueuedTransaction[] = [];
  private processing = false;

  constructor(private executor: TransactionExecutor) {}

  /**
   * Enqueue a transaction for execution.
   * Returns a promise that resolves when the transaction completes.
   */
  async enqueue(to: Address, data: Hex, gasLimit: bigint): Promise<CallResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ to, data, gasLimit, resolve, reject });
      this.processNext();
    });
  }

  /**
   * Process the next transaction in the queue.
   * Only one transaction processes at a time.
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    const tx = this.queue.shift()!;

    try {
      const result = await this.executor(tx.to, tx.data, tx.gasLimit);
      tx.resolve(result);
    } catch (error) {
      tx.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.processing = false;
      // Process next item if any
      if (this.queue.length > 0) {
        // Use setImmediate/setTimeout to prevent stack overflow on long queues
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Get the number of pending transactions in the queue
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing a transaction
   */
  get isProcessing(): boolean {
    return this.processing;
  }
}
