/**
 * Scheduler Service
 *
 * Manages cron-like scheduled tasks for business rules.
 * Follows the singleton pattern like RabbitMQConnectionManager.
 *
 * Usage:
 * - Rules register schedules via registerSchedule()
 * - Schedules are tracked per rule for cleanup
 * - RuleManager calls shutdown() during service shutdown
 */

import cron from 'node-cron';
import { nanoid } from 'nanoid';
import { businessLogicLogger, ruleLog } from '../lib/logger';
import type {
  ScheduleCallback,
  ScheduleOptions,
  ScheduledTask,
  SchedulerStatus,
  ScheduledTaskStatus,
} from './types';

const log = businessLogicLogger.child({ component: 'SchedulerService' });

// =============================================================================
// Scheduler Service Implementation
// =============================================================================

/**
 * Singleton service for managing scheduled tasks.
 */
class SchedulerServiceImpl {
  private tasks: Map<string, ScheduledTask> = new Map();
  private tasksByRule: Map<string, Set<string>> = new Map();
  private isRunning = false;
  private totalExecutions = 0;

  /**
   * Start the scheduler service.
   * Called during RuleManager startup.
   */
  start(): void {
    if (this.isRunning) {
      log.warn({ msg: 'SchedulerService already running' });
      return;
    }

    ruleLog.workerLifecycle(log, 'SchedulerService', 'starting');
    this.isRunning = true;
    ruleLog.workerLifecycle(log, 'SchedulerService', 'started');
  }

  /**
   * Stop the scheduler service.
   * Cancels all scheduled tasks.
   */
  async shutdown(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    ruleLog.workerLifecycle(log, 'SchedulerService', 'stopping');

    // Stop all tasks
    for (const task of this.tasks.values()) {
      task.task.stop();
    }

    this.tasks.clear();
    this.tasksByRule.clear();
    this.isRunning = false;

    ruleLog.workerLifecycle(log, 'SchedulerService', 'stopped');
  }

  /**
   * Register a scheduled task for a rule.
   *
   * @param ruleName - Name of the rule registering the schedule
   * @param options - Schedule options
   * @param callback - Function to execute on schedule
   * @returns Task ID for manual unregistration (optional)
   */
  registerSchedule(
    ruleName: string,
    options: ScheduleOptions,
    callback: ScheduleCallback
  ): string {
    if (!this.isRunning) {
      throw new Error('SchedulerService not running. Call start() first.');
    }

    // Validate cron expression
    if (!cron.validate(options.cronExpression)) {
      throw new Error(`Invalid cron expression: ${options.cronExpression}`);
    }

    const taskId = nanoid();
    const timezone = options.timezone ?? 'UTC';

    // Wrap callback with error handling and metrics
    const wrappedCallback = async () => {
      const task = this.tasks.get(taskId);
      if (!task) return;

      log.debug(
        {
          taskId,
          ruleName,
          cronExpression: options.cronExpression,
          description: options.description,
        },
        'Executing scheduled task'
      );

      const startTime = Date.now();

      try {
        await callback();
        task.lastExecutionAt = new Date();
        task.executionCount++;
        task.lastError = null;
        this.totalExecutions++;

        const durationMs = Date.now() - startTime;
        log.debug(
          {
            taskId,
            ruleName,
            executionCount: task.executionCount,
            durationMs,
          },
          'Scheduled task completed'
        );
      } catch (error) {
        task.lastError = error instanceof Error ? error : new Error(String(error));
        task.lastExecutionAt = new Date();
        task.executionCount++;
        this.totalExecutions++;

        const durationMs = Date.now() - startTime;
        log.error(
          {
            taskId,
            ruleName,
            error: task.lastError.message,
            durationMs,
          },
          'Scheduled task failed'
        );
      }
    };

    // Create the cron task
    const cronTask = cron.schedule(options.cronExpression, wrappedCallback, {
      scheduled: true,
      timezone,
    });

    const scheduledTask: ScheduledTask = {
      id: taskId,
      ruleName,
      cronExpression: options.cronExpression,
      description: options.description,
      timezone,
      callback,
      task: cronTask,
      registeredAt: new Date(),
      lastExecutionAt: null,
      executionCount: 0,
      lastError: null,
    };

    // Track task
    this.tasks.set(taskId, scheduledTask);

    // Track by rule name for cleanup
    if (!this.tasksByRule.has(ruleName)) {
      this.tasksByRule.set(ruleName, new Set());
    }
    this.tasksByRule.get(ruleName)!.add(taskId);

    log.info(
      {
        taskId,
        ruleName,
        cronExpression: options.cronExpression,
        description: options.description,
        timezone,
      },
      'Scheduled task registered'
    );

    // Run immediately if requested
    if (options.runOnStart) {
      log.debug({ taskId, ruleName }, 'Running scheduled task immediately (runOnStart)');
      wrappedCallback().catch((err) => {
        log.error(
          { taskId, ruleName, error: err instanceof Error ? err.message : String(err) },
          'Error in runOnStart execution'
        );
      });
    }

    return taskId;
  }

  /**
   * Unregister a specific scheduled task.
   *
   * @param taskId - Task ID to unregister
   */
  unregisterSchedule(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn({ taskId }, 'Task not found for unregistration');
      return;
    }

    task.task.stop();
    this.tasks.delete(taskId);

    // Remove from rule tracking
    const ruleTasks = this.tasksByRule.get(task.ruleName);
    if (ruleTasks) {
      ruleTasks.delete(taskId);
      if (ruleTasks.size === 0) {
        this.tasksByRule.delete(task.ruleName);
      }
    }

    log.info(
      {
        taskId,
        ruleName: task.ruleName,
        description: task.description,
      },
      'Scheduled task unregistered'
    );
  }

  /**
   * Unregister all scheduled tasks for a rule.
   * Called during rule shutdown.
   *
   * @param ruleName - Name of the rule
   */
  unregisterAllForRule(ruleName: string): void {
    const taskIds = this.tasksByRule.get(ruleName);
    if (!taskIds || taskIds.size === 0) {
      return;
    }

    log.info(
      { ruleName, taskCount: taskIds.size },
      'Unregistering all scheduled tasks for rule'
    );

    // Copy to array since we're modifying during iteration
    for (const taskId of Array.from(taskIds)) {
      this.unregisterSchedule(taskId);
    }
  }

  /**
   * Get status of the scheduler service.
   */
  getStatus(): SchedulerStatus {
    const scheduledTasks: ScheduledTaskStatus[] = Array.from(this.tasks.values()).map(
      (task) => ({
        id: task.id,
        ruleName: task.ruleName,
        cronExpression: task.cronExpression,
        description: task.description,
        timezone: task.timezone,
        registeredAt: task.registeredAt.toISOString(),
        lastExecutionAt: task.lastExecutionAt?.toISOString() ?? null,
        executionCount: task.executionCount,
        lastError: task.lastError?.message ?? null,
      })
    );

    return {
      isRunning: this.isRunning,
      scheduledTasks,
      totalExecutions: this.totalExecutions,
    };
  }

  /**
   * Check if the service is running.
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

// =============================================================================
// Singleton
// =============================================================================

// Use globalThis to prevent singleton from being reset during Hot Module Reloading
const globalForScheduler = globalThis as unknown as {
  businessLogicScheduler: SchedulerServiceImpl | undefined;
};

export function getSchedulerService(): SchedulerServiceImpl {
  if (!globalForScheduler.businessLogicScheduler) {
    globalForScheduler.businessLogicScheduler = new SchedulerServiceImpl();
  }
  return globalForScheduler.businessLogicScheduler;
}

export { SchedulerServiceImpl as SchedulerService };
