/**
 * Strategy Mailbox
 *
 * Per-strategy FIFO event queue ensuring strict event ordering.
 * This is a CRITICAL component - each strategy must process events sequentially.
 */

import type { StrategyEvent } from '@midcurve/shared';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

/**
 * Per-strategy mailbox for event ordering
 *
 * Ensures events are processed strictly in order for each strategy.
 * The mailbox is an in-memory FIFO queue.
 */
export class StrategyMailbox {
  private readonly queue: StrategyEvent[] = [];
  private readonly strategyId: string;
  private readonly logger: ServiceLogger;

  constructor(strategyId: string) {
    this.strategyId = strategyId;
    this.logger = createServiceLogger(`StrategyMailbox:${strategyId}`);
  }

  /**
   * Get the strategy ID this mailbox belongs to
   */
  getStrategyId(): string {
    return this.strategyId;
  }

  /**
   * Enqueue an event to be processed
   */
  enqueue(event: StrategyEvent): void {
    this.queue.push(event);
    this.logger.debug(
      { eventType: event.eventType, queueLength: this.queue.length },
      'Event enqueued'
    );
  }

  /**
   * Enqueue multiple events
   */
  enqueueAll(events: StrategyEvent[]): void {
    for (const event of events) {
      this.queue.push(event);
    }
    if (events.length > 0) {
      this.logger.debug(
        { count: events.length, queueLength: this.queue.length },
        'Events enqueued'
      );
    }
  }

  /**
   * Dequeue the next event to process
   * Returns undefined if queue is empty
   */
  dequeue(): StrategyEvent | undefined {
    const event = this.queue.shift();
    if (event) {
      this.logger.debug(
        { eventType: event.eventType, queueLength: this.queue.length },
        'Event dequeued'
      );
    }
    return event;
  }

  /**
   * Peek at the next event without removing it
   */
  peek(): StrategyEvent | undefined {
    return this.queue[0];
  }

  /**
   * Check if the mailbox has pending events
   */
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Get the number of pending events
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear all pending events
   */
  clear(): void {
    const count = this.queue.length;
    this.queue.length = 0;
    if (count > 0) {
      this.logger.warn({ clearedCount: count }, 'Mailbox cleared');
    }
  }
}

/**
 * Mailbox Manager
 *
 * Manages mailboxes for all active strategies.
 * Provides centralized access to per-strategy mailboxes.
 */
export class MailboxManager {
  private readonly mailboxes: Map<string, StrategyMailbox> = new Map();
  private readonly logger: ServiceLogger;

  constructor() {
    this.logger = createServiceLogger('MailboxManager');
  }

  /**
   * Get or create a mailbox for a strategy
   */
  getMailbox(strategyId: string): StrategyMailbox {
    let mailbox = this.mailboxes.get(strategyId);
    if (!mailbox) {
      mailbox = new StrategyMailbox(strategyId);
      this.mailboxes.set(strategyId, mailbox);
      this.logger.debug({ strategyId }, 'Mailbox created');
    }
    return mailbox;
  }

  /**
   * Check if a mailbox exists for a strategy
   */
  hasMailbox(strategyId: string): boolean {
    return this.mailboxes.has(strategyId);
  }

  /**
   * Remove a mailbox (e.g., when strategy is stopped)
   */
  removeMailbox(strategyId: string): void {
    const mailbox = this.mailboxes.get(strategyId);
    if (mailbox) {
      mailbox.clear();
      this.mailboxes.delete(strategyId);
      this.logger.debug({ strategyId }, 'Mailbox removed');
    }
  }

  /**
   * Get all strategy IDs with pending events
   */
  getStrategiesWithPending(): string[] {
    const result: string[] = [];
    for (const [strategyId, mailbox] of this.mailboxes) {
      if (mailbox.hasPending()) {
        result.push(strategyId);
      }
    }
    return result;
  }

  /**
   * Get total number of pending events across all mailboxes
   */
  getTotalPending(): number {
    let total = 0;
    for (const mailbox of this.mailboxes.values()) {
      total += mailbox.size();
    }
    return total;
  }

  /**
   * Get number of active mailboxes
   */
  getMailboxCount(): number {
    return this.mailboxes.size;
  }

  /**
   * Enqueue an event to a specific strategy's mailbox
   */
  enqueue(strategyId: string, event: StrategyEvent): void {
    const mailbox = this.getMailbox(strategyId);
    mailbox.enqueue(event);
  }

  /**
   * Enqueue events to multiple strategies' mailboxes
   * Used for broadcast events (e.g., OHLC data)
   */
  broadcast(strategyIds: string[], event: StrategyEvent): void {
    for (const strategyId of strategyIds) {
      const mailbox = this.getMailbox(strategyId);
      // Clone event with correct strategyId
      mailbox.enqueue({ ...event, strategyId });
    }
    if (strategyIds.length > 0) {
      this.logger.debug(
        { eventType: event.eventType, strategyCount: strategyIds.length },
        'Event broadcast'
      );
    }
  }

  /**
   * Clear all mailboxes
   */
  clearAll(): void {
    for (const mailbox of this.mailboxes.values()) {
      mailbox.clear();
    }
    this.mailboxes.clear();
    this.logger.info('All mailboxes cleared');
  }
}
