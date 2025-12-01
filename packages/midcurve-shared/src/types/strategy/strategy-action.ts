/**
 * Strategy Action Types
 *
 * User-initiated actions that are validated, stored, and then
 * converted to ActionStrategyEvents for strategy processing.
 */

import type { StrategyActionType } from './strategy-event.js';

/**
 * Strategy action status lifecycle
 *
 * - pending: Action submitted, awaiting processing
 * - accepted: Strategy has accepted the action
 * - rejected: Strategy rejected the action (invalid state/params)
 * - executing: Action is being executed (effects in flight)
 * - finished: Action completed successfully
 * - errored: Action failed during execution
 */
export type StrategyActionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'executing'
  | 'finished'
  | 'errored';

/**
 * Strategy Action Record
 *
 * Represents a user-initiated action submitted to a strategy.
 * Actions are validated, stored, then converted to ActionStrategyEvents.
 */
export interface StrategyAction {
  /** Unique action identifier */
  actionId: string;

  /** Strategy ID this action belongs to */
  strategyId: string;

  /** User who submitted the action */
  userId: string;

  /** Action type */
  actionType: StrategyActionType;

  /** Action-specific payload */
  payload: unknown;

  /** EIP-712 signature of the action intent */
  intentSignature: string;

  /** Serialized action intent payload (JSON) */
  intentPayload: string;

  /** Current action status */
  status: StrategyActionStatus;

  /** Error message (if status is 'rejected' or 'errored') */
  errorMessage: string | null;

  /** Result data (if status is 'finished') */
  result: unknown | null;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

// =============================================================================
// Status Helpers
// =============================================================================

/**
 * Check if an action is in a terminal state
 */
export function isTerminalActionStatus(
  status: StrategyActionStatus
): boolean {
  return (
    status === 'rejected' || status === 'finished' || status === 'errored'
  );
}

/**
 * Check if an action is in a processing state
 */
export function isProcessingActionStatus(
  status: StrategyActionStatus
): boolean {
  return status === 'accepted' || status === 'executing';
}

/**
 * Check if an action can be cancelled
 */
export function canCancelAction(status: StrategyActionStatus): boolean {
  return status === 'pending';
}
