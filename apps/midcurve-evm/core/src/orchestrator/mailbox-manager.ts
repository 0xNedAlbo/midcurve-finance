import type { Address } from 'viem';
import { StrategyMailbox } from './strategy-mailbox.js';
import type { MailboxEvent, MailboxStats } from './types.js';

/**
 * Function that processes an event for a specific strategy
 */
export type EventProcessor = (
  strategyAddress: Address,
  event: MailboxEvent
) => Promise<void>;

/**
 * MailboxManager coordinates all strategy mailboxes.
 *
 * Purpose:
 * - Create and manage mailboxes for each strategy
 * - Dispatch events to the appropriate mailboxes
 * - Enable parallel processing across strategies
 * - Maintain ordered processing within each strategy
 *
 * Concurrency Model:
 * - dispatchToStrategies() sends to multiple mailboxes in parallel
 * - Each mailbox processes its queue sequentially
 * - This achieves parallelism across strategies, order within each
 */
export class MailboxManager {
  /** Map of strategy address -> mailbox */
  private mailboxes: Map<Address, StrategyMailbox> = new Map();

  constructor(
    /** Function to process events (injected by orchestrator) */
    private processor: EventProcessor
  ) {}

  /**
   * Get or create a mailbox for a strategy
   */
  private getMailbox(strategyAddress: Address): StrategyMailbox {
    const normalizedAddress = strategyAddress.toLowerCase() as Address;

    let mailbox = this.mailboxes.get(normalizedAddress);
    if (!mailbox) {
      // Create new mailbox with bound processor
      mailbox = new StrategyMailbox(normalizedAddress, (event) =>
        this.processor(normalizedAddress, event)
      );
      this.mailboxes.set(normalizedAddress, mailbox);
    }

    return mailbox;
  }

  /**
   * Dispatch an event to multiple strategies in parallel.
   * Each strategy's mailbox receives the event independently.
   *
   * @param strategies Array of strategy addresses to dispatch to
   * @param event The event to dispatch
   */
  dispatchToStrategies(strategies: Address[], event: MailboxEvent): void {
    for (const strategy of strategies) {
      const mailbox = this.getMailbox(strategy);
      mailbox.enqueue(event);
    }
  }

  /**
   * Dispatch an event to a single strategy.
   * Used for effect results which go to a specific strategy.
   *
   * @param strategy The strategy address
   * @param event The event to dispatch
   */
  dispatchToStrategy(strategy: Address, event: MailboxEvent): void {
    const mailbox = this.getMailbox(strategy);
    mailbox.enqueue(event);
  }

  /**
   * Get statistics about mailbox state.
   * Useful for monitoring and debugging.
   */
  getStats(): MailboxStats {
    const stats: MailboxStats = {
      totalPending: 0,
      byStrategy: {},
    };

    for (const [address, mailbox] of this.mailboxes) {
      const pending = mailbox.pendingCount;
      if (pending > 0 || mailbox.isProcessing) {
        stats.totalPending += pending + (mailbox.isProcessing ? 1 : 0);
        stats.byStrategy[address] = pending + (mailbox.isProcessing ? 1 : 0);
      }
    }

    return stats;
  }

  /**
   * Check if any mailbox is busy (has pending or processing events)
   */
  hasPendingWork(): boolean {
    for (const mailbox of this.mailboxes.values()) {
      if (mailbox.isBusy) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the total number of pending events across all mailboxes
   */
  get totalPendingCount(): number {
    let total = 0;
    for (const mailbox of this.mailboxes.values()) {
      total += mailbox.pendingCount;
    }
    return total;
  }

  /**
   * Get the number of active mailboxes
   */
  get mailboxCount(): number {
    return this.mailboxes.size;
  }

  /**
   * Remove a mailbox (e.g., when a strategy is undeployed)
   */
  removeMailbox(strategyAddress: Address): boolean {
    const normalizedAddress = strategyAddress.toLowerCase() as Address;
    return this.mailboxes.delete(normalizedAddress);
  }

  /**
   * Clear all mailboxes (useful for testing)
   */
  clear(): void {
    this.mailboxes.clear();
  }
}
