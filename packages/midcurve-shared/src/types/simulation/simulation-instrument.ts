/**
 * SimulationInstrument Interface
 *
 * Transforms the portfolio state when a price threshold is crossed.
 * Instruments fire once and are removed from the active set.
 *
 * Implementations:
 * - ClosePositionInstrument: full close (SL or TP)
 */

import type { SimulationState } from './simulation-state.js';

export type TriggerDirection = 'above' | 'below';

export interface SimulationInstrument {
  /** Unique identifier */
  readonly id: string;
  /** Which component this instrument acts on */
  readonly targetComponentId: string;
  /** Price threshold that activates this instrument */
  readonly triggerPrice: bigint;
  /** Direction: 'below' means triggers when price crosses downward */
  readonly triggerDirection: TriggerDirection;
  /** Transform state when triggered. Returns new state. */
  apply(state: SimulationState, triggerPrice: bigint): SimulationState;
}
