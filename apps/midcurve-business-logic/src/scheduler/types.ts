/**
 * Scheduler Types
 *
 * Type definitions for the cron-like scheduling system.
 */

import type { ScheduledTask as NodeCronTask } from 'node-cron';

/**
 * Callback function invoked when a schedule fires.
 */
export type ScheduleCallback = () => Promise<void> | void;

/**
 * Options for registering a schedule.
 */
export interface ScheduleOptions {
  /**
   * Cron expression (e.g., "0/5 * * * *" for every 5 minutes).
   *
   * Standard cron format: minute hour day-of-month month day-of-week
   *
   * Examples:
   * - "* * * * *" - Every minute
   * - "0/5 * * * *" - Every 5 minutes
   * - "0 * * * *" - Every hour
   * - "0 0 * * *" - Every day at midnight
   * - "0 0 * * 0" - Every Sunday at midnight
   */
  cronExpression: string;

  /**
   * Human-readable description of what this schedule does.
   */
  description: string;

  /**
   * Timezone for the schedule (default: 'UTC').
   *
   * Examples: 'UTC', 'America/New_York', 'Europe/London'
   */
  timezone?: string;

  /**
   * Whether to run the callback immediately on registration (default: false).
   */
  runOnStart?: boolean;
}

/**
 * Internal representation of a scheduled task.
 */
export interface ScheduledTask {
  /**
   * Unique ID for this task.
   */
  id: string;

  /**
   * Name of the rule that registered this schedule.
   */
  ruleName: string;

  /**
   * Cron expression.
   */
  cronExpression: string;

  /**
   * Human-readable description.
   */
  description: string;

  /**
   * Timezone.
   */
  timezone: string;

  /**
   * The callback to invoke.
   */
  callback: ScheduleCallback;

  /**
   * The underlying node-cron task.
   */
  task: NodeCronTask;

  /**
   * When this schedule was registered.
   */
  registeredAt: Date;

  /**
   * Last execution time (null if never executed).
   */
  lastExecutionAt: Date | null;

  /**
   * Total execution count.
   */
  executionCount: number;

  /**
   * Last error (null if no error).
   */
  lastError: Error | null;
}

/**
 * Status of the scheduler service.
 */
export interface SchedulerStatus {
  isRunning: boolean;
  scheduledTasks: ScheduledTaskStatus[];
  totalExecutions: number;
}

/**
 * Status of a single scheduled task.
 */
export interface ScheduledTaskStatus {
  id: string;
  ruleName: string;
  cronExpression: string;
  description: string;
  timezone: string;
  registeredAt: string;
  lastExecutionAt: string | null;
  executionCount: number;
  lastError: string | null;
}
