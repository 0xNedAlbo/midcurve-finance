/**
 * Strategy State Transitions
 *
 * Defines valid state transitions for strategies and provides
 * validation helpers.
 */

import type { StrategyStatus } from '@midcurve/shared';

/**
 * Type for state transition map
 */
type StateTransitionMap = {
  [K in StrategyStatus]: readonly StrategyStatus[];
};

/**
 * Valid state transitions for strategies
 *
 * Key: Current state
 * Value: Array of valid next states
 */
export const VALID_STATE_TRANSITIONS: StateTransitionMap = {
  pending: ['active'], // Can only activate from pending
  active: ['paused', 'shutdown'], // Can pause or shutdown from active
  paused: ['active', 'shutdown'], // Can resume or shutdown from paused
  shutdown: [], // Terminal state - no transitions allowed
};

/**
 * Check if a state transition is valid
 *
 * @param from - Current state
 * @param to - Target state
 * @returns true if transition is valid
 */
export function isValidTransition(from: StrategyStatus, to: StrategyStatus): boolean {
  // Use non-null assertion since we know all states are covered
  const validNextStates = VALID_STATE_TRANSITIONS[from]!;
  return validNextStates.includes(to);
}

/**
 * Get valid next states from a given state
 *
 * @param state - Current state
 * @returns Array of valid next states
 */
export function getValidNextStates(state: StrategyStatus): readonly StrategyStatus[] {
  // Use non-null assertion since we know all states are covered
  return VALID_STATE_TRANSITIONS[state]!;
}

/**
 * Error thrown when an invalid state transition is attempted
 */
export class StrategyInvalidStateError extends Error {
  public readonly from: StrategyStatus;
  public readonly to: StrategyStatus;
  public readonly strategyId: string;

  constructor(strategyId: string, from: StrategyStatus, to: StrategyStatus) {
    // Use non-null assertion since we know all states are covered
    const validStates = VALID_STATE_TRANSITIONS[from]!;
    const validStr = validStates.length > 0 ? validStates.join(', ') : 'none (terminal state)';
    super(
      `Invalid state transition for strategy ${strategyId}: ` +
        `${from} -> ${to}. Valid transitions from '${from}': ${validStr}`
    );
    this.name = 'StrategyInvalidStateError';
    this.strategyId = strategyId;
    this.from = from;
    this.to = to;
  }
}

/**
 * Check if strategy is in a terminal state
 *
 * @param state - Strategy state
 * @returns true if state is terminal (no further transitions allowed)
 */
export function isTerminalState(state: StrategyStatus): boolean {
  // Use non-null assertion since we know all states are covered
  return VALID_STATE_TRANSITIONS[state]!.length === 0;
}

/**
 * Check if strategy can be modified (not in terminal state)
 *
 * @param state - Strategy state
 * @returns true if strategy can be modified
 */
export function canModify(state: StrategyStatus): boolean {
  return !isTerminalState(state);
}
