import type { Address } from 'viem';
import type { MailboxEvent } from './types.js';

/**
 * Processor function that handles a single mailbox event
 */
export type MailboxProcessor = (event: MailboxEvent) => Promise<void>;

/**
 * StrategyMailbox is a per-strategy event queue.
 *
 * Purpose:
 * - Ensures events for a single strategy are processed sequentially
 * - Prevents race conditions within a strategy's state machine
 * - Allows multiple strategies to process events in parallel
 *
 * Design:
 * - Each strategy has its own mailbox
 * - Events are enqueued and processed in order
 * - Processing is non-blocking (returns immediately after enqueue)
 */
export class StrategyMailbox {
  /** FIFO queue of events waiting to be processed */
  private queue: MailboxEvent[] = [];

  /** Whether we're currently processing events */
  private processing = false;

  constructor(
    /** The strategy this mailbox belongs to */
    public readonly strategyAddress: Address,
    /** Function to process each event */
    private processor: MailboxProcessor
  ) {}

  /**
   * Add an event to the mailbox queue.
   * Triggers processing if not already running.
   *
   * @param event The event to enqueue
   */
  enqueue(event: MailboxEvent): void {
    this.queue.push(event);
    // Start processing (non-blocking)
    void this.processNext();
  }

  /**
   * Process events from the queue sequentially.
   * This method is designed to be called without awaiting.
   */
  private async processNext(): Promise<void> {
    // Prevent concurrent processing within this mailbox
    if (this.processing) {
      return;
    }

    // Mark as processing
    this.processing = true;

    try {
      // Process all queued events in order
      while (this.queue.length > 0) {
        const event = this.queue.shift()!;

        try {
          await this.processor(event);
        } catch (error) {
          // Log error but continue processing next events
          // The orchestrator's processor should handle its own errors,
          // but we catch here as a safety net
          console.error(
            `Mailbox error for strategy ${this.strategyAddress}:`,
            error
          );
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get the number of events waiting in the queue
   */
  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Check if the mailbox is currently processing events
   */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Check if the mailbox has any pending or in-progress events
   */
  get isBusy(): boolean {
    return this.processing || this.queue.length > 0;
  }
}
