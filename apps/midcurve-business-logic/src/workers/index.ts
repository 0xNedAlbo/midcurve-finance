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
  UpdatePositionMetricsOnPoolPriceRule,
  type BusinessRuleStatus,
} from '../rules';

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
    // Position metrics updater - updates value, PnL, and unclaimed fees on pool price changes
    this.registry.register(new UpdatePositionMetricsOnPoolPriceRule());

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
      // Connect to RabbitMQ first (this also sets up topology)
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
      // Stop all rules first
      log.info({ msg: 'Stopping all rules...' });
      await this.registry.stopAll();

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

    return {
      isRunning: this.isRunning,
      rules: this.registry.getStatus(),
      rabbitmq: {
        isConnected: mq.isConnected(),
      },
    };
  }
}
