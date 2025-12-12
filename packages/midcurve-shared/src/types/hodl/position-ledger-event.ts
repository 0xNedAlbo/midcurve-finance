/**
 * HODL Position Ledger Event Types
 *
 * Re-exports and type aliases for HODL position ledger events.
 */

import type { PositionLedgerEvent } from '../position-ledger-event.js';
import type { PositionLedgerEventConfigMap } from '../position-ledger-event-config.js';

// Re-export config types
export type { HodlLedgerEventConfig } from './position-ledger-event-config.js';

// Re-export state types
export type {
  HodlLedgerEventState,
  HodlEventType,
  HodlExternalDepositEvent,
  HodlExternalWithdrawEvent,
  HodlTradeInEvent,
  HodlTradeOutEvent,
  HodlTradeFeesEvent,
  HodlInternalAllocationInflowEvent,
  HodlInternalAllocationOutflowEvent,
} from './position-ledger-event-state.js';

/**
 * Type alias for HODL ledger event
 *
 * Equivalent to PositionLedgerEvent<'hodl'>.
 * Uses the generic PositionLedgerEvent interface with HODL-specific config and state.
 */
export type HodlLedgerEvent = PositionLedgerEvent<'hodl'>;

/**
 * Type guard for HODL ledger events
 *
 * Safely narrows AnyLedgerEvent to HodlLedgerEvent, allowing access to
 * HODL-specific config and state fields.
 *
 * @param event - Ledger event to check
 * @returns True if event is a HODL ledger event
 *
 * @example
 * ```typescript
 * const event: AnyLedgerEvent = await getEvent();
 *
 * if (isHodlLedgerEvent(event)) {
 *   // TypeScript knows event is HodlLedgerEvent here
 *   console.log(event.config.tokenPriceInQuote);
 *   console.log(event.state.eventType);
 * }
 * ```
 */
export function isHodlLedgerEvent(
  event: PositionLedgerEvent<keyof PositionLedgerEventConfigMap>
): event is HodlLedgerEvent {
  return event.protocol === 'hodl';
}

/**
 * Assertion function for HODL ledger events
 *
 * Throws an error if event is not a HODL ledger event.
 * After calling this function, TypeScript knows the event is HodlLedgerEvent.
 *
 * @param event - Ledger event to check
 * @throws Error if event is not a HODL ledger event
 *
 * @example
 * ```typescript
 * const event: AnyLedgerEvent = await getEvent();
 *
 * assertHodlLedgerEvent(event);
 * // TypeScript knows event is HodlLedgerEvent after this line
 * console.log(event.config.tokenPriceInQuote);
 * ```
 */
export function assertHodlLedgerEvent(
  event: PositionLedgerEvent<keyof PositionLedgerEventConfigMap>
): asserts event is HodlLedgerEvent {
  if (!isHodlLedgerEvent(event)) {
    throw new Error(
      `Expected HODL ledger event, got protocol: ${(event as PositionLedgerEvent<keyof PositionLedgerEventConfigMap>).protocol}`
    );
  }
}
