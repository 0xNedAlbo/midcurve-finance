/**
 * Close Order Execution Types
 *
 * Types for individual execution attempts of close orders.
 * Each execution records the trigger context, execution lifecycle, and result.
 *
 * Follows the HedgeVaultExecution pattern: execution attempts are separate
 * entities from the order itself, allowing clean tracking of retries and
 * supporting future competing executor scenarios.
 */

/**
 * Execution attempt status.
 *
 * pending:   Trigger detected, execution queued
 * executing: Transaction submitted, waiting for confirmation
 * completed: Execution succeeded on-chain
 * failed:    Execution permanently failed (max retries exhausted)
 */
export type CloseOrderExecutionStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed';
