/**
 * RuleManager
 *
 * Coordinates all business rules in the business logic service.
 * Manages lifecycle: start, stop, and status reporting.
 *
 * Responsibilities:
 * - Connect to RabbitMQ
 * - Register all rules from the registry
 * - Start/stop rules in correct order
 * - Provide unified status reporting
 */

import { businessLogicLogger, ruleLog } from '../lib/logger';
import { getRabbitMQConnection } from '../mq/connection-manager';
import {
  RuleRegistry,
  EnrichCoingeckoTokensRule,
  RefreshCoingeckoTokensRule,
  UpdatePositionOnLiquidityEventRule,
  ProcessCloseOrderEventsRule,
  CreateAutomationWalletOnUserRegisteredRule,
  PostJournalEntriesOnPositionEventsRule,
  DailyNavSnapshotRule,
  type BusinessRuleStatus,
} from '../rules';
import { getSchedulerService, type SchedulerStatus } from '../scheduler';

const log = businessLogicLogger.child({ component: 'RuleManager' });

/**
 * Status of the RuleManager
 */
export interface RuleManagerStatus {
  isRunning: boolean;
  rules: BusinessRuleStatus[];
  rabbitmq: {
    isConnected: boolean;
  };
  scheduler: SchedulerStatus;
}

/**
 * RuleManager coordinates all business rules.
 */
export class RuleManager {
  private readonly registry: RuleRegistry;
  private isRunning = false;

  constructor() {
    this.registry = new RuleRegistry();
    this.registerRules();
  }

  /**
   * Register all business rules.
   *
   * Add new rules here as they are implemented.
   */
  private registerRules(): void {
    // Platform-wide rules
    // CoinGecko token list refresh - runs daily at 3:17 AM UTC
    this.registry.register(new RefreshCoingeckoTokensRule());

    // CoinGecko token enrichment - runs every 5 minutes
    this.registry.register(new EnrichCoingeckoTokensRule());

    // Position liquidity event handler - imports ledger events and refreshes positions
    this.registry.register(new UpdatePositionOnLiquidityEventRule());

    // Close order lifecycle event handler - syncs close orders with on-chain state
    this.registry.register(new ProcessCloseOrderEventsRule());

    // User lifecycle rules
    // Auto-create automation wallet when new user registers
    this.registry.register(new CreateAutomationWalletOnUserRegisteredRule());

    // Accounting rules
    // Double-entry journal entries from position domain events
    this.registry.register(new PostJournalEntriesOnPositionEventsRule());

    // Daily NAV snapshot and position refresh - runs at midnight UTC
    this.registry.register(new DailyNavSnapshotRule());

    log.info({ ruleCount: this.registry.size, msg: 'Rules registered' });
  }

  /**
   * Start the rule manager.
   * Connects to RabbitMQ and starts all registered rules.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn({ msg: 'RuleManager already running' });
      return;
    }

    ruleLog.workerLifecycle(log, 'RuleManager', 'starting');

    try {
      // Start scheduler service first (rules may register schedules during startup)
      log.info({ msg: 'Starting scheduler service...' });
      const scheduler = getSchedulerService();
      scheduler.start();

      // Connect to RabbitMQ (this also sets up topology)
      log.info({ msg: 'Connecting to RabbitMQ...' });
      const mq = getRabbitMQConnection();
      const channel = await mq.getChannel();

      // Start all registered rules
      log.info({ ruleCount: this.registry.size, msg: 'Starting all rules...' });
      await this.registry.startAll(channel);

      this.isRunning = true;
      ruleLog.workerLifecycle(log, 'RuleManager', 'started', {
        ruleCount: this.registry.size,
      });
    } catch (error) {
      ruleLog.workerLifecycle(log, 'RuleManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop the rule manager.
   * Gracefully stops all rules and disconnects from RabbitMQ.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      log.warn({ msg: 'RuleManager not running' });
      return;
    }

    ruleLog.workerLifecycle(log, 'RuleManager', 'stopping');

    try {
      // Stop all rules first (this unregisters their schedules)
      log.info({ msg: 'Stopping all rules...' });
      await this.registry.stopAll();

      // Stop scheduler service (cleanup any remaining tasks)
      log.info({ msg: 'Stopping scheduler service...' });
      const scheduler = getSchedulerService();
      await scheduler.shutdown();

      // Close RabbitMQ connection
      log.info({ msg: 'Closing RabbitMQ connection...' });
      const mq = getRabbitMQConnection();
      await mq.close();

      this.isRunning = false;
      ruleLog.workerLifecycle(log, 'RuleManager', 'stopped');
    } catch (error) {
      ruleLog.workerLifecycle(log, 'RuleManager', 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get the status of the rule manager and all rules.
   */
  getStatus(): RuleManagerStatus {
    const mq = getRabbitMQConnection();
    const scheduler = getSchedulerService();

    return {
      isRunning: this.isRunning,
      rules: this.registry.getStatus(),
      rabbitmq: {
        isConnected: mq.isConnected(),
      },
      scheduler: scheduler.getStatus(),
    };
  }
}
