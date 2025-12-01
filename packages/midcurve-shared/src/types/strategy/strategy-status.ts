/**
 * Strategy Status Types
 *
 * Defines the lifecycle states for automated strategies.
 */

/**
 * Strategy lifecycle status
 *
 * - pending: Strategy created but not yet activated
 * - active: Strategy is running and processing events
 * - paused: Strategy is temporarily stopped (can be resumed)
 * - stopped: Strategy has been stopped by user (can be restarted)
 * - completed: Strategy has completed its objective
 * - error: Strategy encountered an error and stopped
 */
export type StrategyStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error';

/**
 * Check if a strategy status indicates the strategy is runnable
 */
export function isRunnableStatus(status: StrategyStatus): boolean {
  return status === 'active';
}

/**
 * Check if a strategy status indicates the strategy is terminated
 */
export function isTerminatedStatus(status: StrategyStatus): boolean {
  return status === 'completed' || status === 'error';
}

/**
 * Check if a strategy can be resumed from current status
 */
export function canResumeFromStatus(status: StrategyStatus): boolean {
  return status === 'paused' || status === 'stopped';
}
