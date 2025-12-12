/**
 * HODL Position Types
 *
 * Type definitions for HODL positions.
 * HODL positions track baskets of tokens valued in a user-selected quote token.
 *
 * Key characteristics:
 * - Multi-token basket (holds multiple tokens simultaneously)
 * - Value measured in user-selected quote token
 * - Average cost basis methodology
 * - Used by automated strategies to track unallocated assets
 */

import type { Position } from '../position.js';
import type { PositionConfigMap } from '../position-config.js';

export type { HodlPositionConfig } from './position-config.js';
export type { HodlPositionState, HodlPositionHolding } from './position-state.js';

/**
 * Type alias for HODL position
 *
 * Equivalent to Position<'hodl'>.
 * Uses the generic Position interface with HODL-specific config and state.
 */
export type HodlPosition = Position<'hodl'>;

/**
 * Type guard for HODL positions
 *
 * Safely narrows AnyPosition to HodlPosition, allowing access to
 * HODL-specific config and state fields.
 *
 * @param position - Position to check
 * @returns True if position is a HODL position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * if (isHodlPosition(position)) {
 *   // TypeScript knows position is HodlPosition here
 *   console.log(position.state.holdings);
 * }
 * ```
 */
export function isHodlPosition(
  position: Position<keyof PositionConfigMap>
): position is HodlPosition {
  return position.protocol === 'hodl';
}

/**
 * Assertion function for HODL positions
 *
 * Throws an error if position is not a HODL position.
 * After calling this function, TypeScript knows the position is HodlPosition.
 *
 * @param position - Position to check
 * @throws Error if position is not a HODL position
 *
 * @example
 * ```typescript
 * const position: AnyPosition = await getPosition();
 *
 * assertHodlPosition(position);
 * // TypeScript knows position is HodlPosition after this line
 * console.log(position.state.holdings);
 * ```
 */
export function assertHodlPosition(
  position: Position<keyof PositionConfigMap>
): asserts position is HodlPosition {
  if (!isHodlPosition(position)) {
    throw new Error(
      `Expected HODL position, got protocol: ${(position as Position<keyof PositionConfigMap>).protocol}`
    );
  }
}
