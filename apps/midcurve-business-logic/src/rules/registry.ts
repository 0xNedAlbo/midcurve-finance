/**
 * Rule Registry
 *
 * Manages registration and lifecycle of all business rules.
 * Provides bulk operations for starting/stopping all rules.
 */

import type { Channel } from 'amqplib';
import { createServiceLogger } from '@midcurve/services';
import type { ServiceLogger } from '@midcurve/services';
import type { BusinessRule, BusinessRuleStatus } from './base';

/**
 * Registry for managing business rules.
 *
 * Handles rule registration and provides bulk lifecycle operations.
 * Rules are registered by name and can only be registered once.
 */
export class RuleRegistry {
  private readonly rules: Map<string, BusinessRule> = new Map();
  private readonly logger: ServiceLogger;

  constructor() {
    this.logger = createServiceLogger('RuleRegistry');
  }

  /**
   * Register a business rule.
   *
   * @param rule - The rule to register
   * @throws Error if a rule with the same name is already registered
   */
  register(rule: BusinessRule): void {
    if (this.rules.has(rule.ruleName)) {
      throw new Error(`Rule already registered: ${rule.ruleName}`);
    }

    this.rules.set(rule.ruleName, rule);
    this.logger.info(
      { ruleName: rule.ruleName, ruleDescription: rule.ruleDescription },
      'Rule registered'
    );
  }

  /**
   * Start all registered rules.
   *
   * @param channel - RabbitMQ channel for event consumption
   */
  async startAll(channel: Channel): Promise<void> {
    this.logger.info({ count: this.rules.size }, 'Starting all rules');

    for (const rule of this.rules.values()) {
      await rule.startup(channel);
    }

    this.logger.info({ count: this.rules.size }, 'All rules started');
  }

  /**
   * Stop all registered rules.
   */
  async stopAll(): Promise<void> {
    this.logger.info({ count: this.rules.size }, 'Stopping all rules');

    // Stop in reverse order (LIFO)
    const rules = Array.from(this.rules.values()).reverse();
    for (const rule of rules) {
      try {
        await rule.shutdown();
      } catch (error) {
        this.logger.error(
          {
            ruleName: rule.ruleName,
            error: error instanceof Error ? error.message : String(error),
          },
          'Error stopping rule'
        );
        // Continue stopping other rules even if one fails
      }
    }

    this.logger.info({ count: this.rules.size }, 'All rules stopped');
  }

  /**
   * Get a rule by name.
   *
   * @param ruleName - The name of the rule to get
   * @returns The rule, or undefined if not found
   */
  get(ruleName: string): BusinessRule | undefined {
    return this.rules.get(ruleName);
  }

  /**
   * Get all registered rules.
   */
  getAll(): BusinessRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get status of all rules.
   */
  getStatus(): BusinessRuleStatus[] {
    return this.getAll().map((rule) => rule.getStatus());
  }

  /**
   * Get the number of registered rules.
   */
  get size(): number {
    return this.rules.size;
  }
}
