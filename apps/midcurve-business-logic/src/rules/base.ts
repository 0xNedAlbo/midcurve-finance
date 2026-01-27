/**
 * Business Rule Base Class
 *
 * Abstract base class for all business rules in the business logic processor.
 *
 * Rules are self-contained business logic processors that can subscribe to
 * various event sources:
 * - Domain events (position.created, order.triggered, etc.)
 * - Onchain data events (pool prices, position liquidity changes)
 * - Automation events (future)
 *
 * Each rule manages its own event subscriptions in the onStartup() method,
 * providing flexibility to listen to different event types and exchanges.
 */

import type { Channel } from 'amqplib';
import { createServiceLogger } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';
import { ruleLog } from '../lib/logger';

// =============================================================================
// Types
// =============================================================================

/**
 * Interface for business rule metadata.
 *
 * Every rule must provide a unique name and description.
 */
export interface BusinessRuleMetadata {
  /**
   * Unique identifier for this rule.
   *
   * Should match the filename without extension (kebab-case).
   * Example: 'fetch-ledger-events-when-position-created'
   */
  ruleName: string;

  /**
   * Human-readable description of what this rule does.
   *
   * Should clearly explain the business logic, trigger conditions,
   * and actions performed.
   * Example: 'Fetches historical ledger events when a new position is created'
   */
  ruleDescription: string;
}

/**
 * Status information for a running rule.
 */
export interface BusinessRuleStatus {
  ruleName: string;
  ruleDescription: string;
  isRunning: boolean;
}

// =============================================================================
// Base Class
// =============================================================================

/**
 * Abstract base class for all business rules.
 *
 * ## Lifecycle
 *
 * 1. **Construction**: Rule is instantiated with its logger
 * 2. **startup(channel)**: Called by RuleManager to start the rule
 *    - Stores the channel for event consumption
 *    - Calls `onStartup()` for rule-specific initialization
 * 3. **shutdown()**: Called by RuleManager to stop the rule
 *    - Calls `onShutdown()` for rule-specific cleanup
 *
 * ## Event Subscription
 *
 * Rules manage their own event subscriptions in `onStartup()`. A rule can:
 * - Subscribe to domain events via `setupConsumerQueue()` from @midcurve/services
 * - Subscribe to onchain data events (pool prices, position liquidity)
 * - Subscribe to automation events
 * - Or any combination of the above
 *
 * ## Example Implementation
 *
 * ```typescript
 * export class FetchLedgerEventsRule extends BusinessRule {
 *   readonly ruleName = 'fetch-ledger-events-when-position-created';
 *   readonly ruleDescription = 'Fetches historical ledger events when a new position is created';
 *
 *   private consumerTag: string | null = null;
 *
 *   protected async onStartup(): Promise<void> {
 *     // Subscribe to position.created domain events
 *     const queueName = 'business-logic.fetch-ledger-events';
 *     await setupConsumerQueue(this.channel!, queueName, 'position.created');
 *
 *     const result = await this.channel!.consume(queueName, async (msg) => {
 *       if (!msg) return;
 *       // Process the event...
 *       this.channel!.ack(msg);
 *     });
 *
 *     this.consumerTag = result.consumerTag;
 *   }
 *
 *   protected async onShutdown(): Promise<void> {
 *     if (this.consumerTag && this.channel) {
 *       await this.channel.cancel(this.consumerTag);
 *     }
 *   }
 * }
 * ```
 */
export abstract class BusinessRule implements BusinessRuleMetadata {
  /**
   * Unique identifier for this rule (matches filename without extension).
   */
  abstract readonly ruleName: string;

  /**
   * Human-readable description of what this rule does.
   */
  abstract readonly ruleDescription: string;

  /**
   * Logger instance for this rule.
   */
  protected readonly logger: ServiceLogger;

  /**
   * RabbitMQ channel for event consumption.
   * Set during startup(), null after shutdown().
   */
  protected channel: Channel | null = null;

  /**
   * Whether the rule is currently running.
   */
  private running = false;

  constructor() {
    // Create logger using the class name
    // Subclasses can use this.logger in their onStartup/onShutdown methods
    this.logger = createServiceLogger(this.constructor.name);
  }

  // ===========================================================================
  // Lifecycle Methods
  // ===========================================================================

  /**
   * Start the rule.
   *
   * This method is called by RuleManager during startup. It:
   * 1. Stores the RabbitMQ channel for event consumption
   * 2. Calls `onStartup()` for rule-specific initialization
   * 3. Marks the rule as running
   *
   * @param channel - RabbitMQ channel for event consumption
   */
  async startup(channel: Channel): Promise<void> {
    if (this.running) {
      this.logger.warn({ ruleName: this.ruleName }, 'Rule already running');
      return;
    }

    this.channel = channel;
    ruleLog.ruleLifecycle(this.logger, this.ruleName, 'starting');

    try {
      await this.onStartup();
      this.running = true;
      ruleLog.ruleLifecycle(this.logger, this.ruleName, 'started');
    } catch (error) {
      ruleLog.ruleLifecycle(this.logger, this.ruleName, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the rule.
   *
   * This method is called by RuleManager during shutdown. It:
   * 1. Calls `onShutdown()` for rule-specific cleanup
   * 2. Clears the channel reference
   * 3. Marks the rule as not running
   */
  async shutdown(): Promise<void> {
    if (!this.running) {
      return;
    }

    ruleLog.ruleLifecycle(this.logger, this.ruleName, 'stopping');

    try {
      await this.onShutdown();
      this.running = false;
      this.channel = null;
      ruleLog.ruleLifecycle(this.logger, this.ruleName, 'stopped');
    } catch (error) {
      ruleLog.ruleLifecycle(this.logger, this.ruleName, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if the rule is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the status of this rule.
   */
  getStatus(): BusinessRuleStatus {
    return {
      ruleName: this.ruleName,
      ruleDescription: this.ruleDescription,
      isRunning: this.running,
    };
  }

  // ===========================================================================
  // Abstract Methods - Implement in Subclasses
  // ===========================================================================

  /**
   * Called during startup. Override to set up event consumers and initialize state.
   *
   * This is where rules should:
   * - Subscribe to their relevant event sources (domain events, onchain data, etc.)
   * - Initialize any required state or configuration
   * - Start any background processes
   *
   * The `this.channel` property is available for RabbitMQ operations.
   *
   * @throws Error if initialization fails (rule will not start)
   */
  protected abstract onStartup(): Promise<void>;

  /**
   * Called during shutdown. Override to clean up resources.
   *
   * This is where rules should:
   * - Cancel event consumers
   * - Clean up any resources (timers, connections, etc.)
   * - Flush any pending operations
   *
   * @throws Error if cleanup fails (logged but shutdown continues)
   */
  protected abstract onShutdown(): Promise<void>;
}
