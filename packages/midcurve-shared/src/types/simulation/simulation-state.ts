/**
 * Simulation State and Result Types
 *
 * Core data structures for the simulation engine's persistent state,
 * triggered event records, simulation results, and PnL curve points.
 */

import type { SimulationComponent } from './simulation-component.js';
import type { SimulationInstrument } from './simulation-instrument.js';

// ============================================================================
// STATE
// ============================================================================

export interface SimulationState {
  /** Active components that produce portfolio value */
  components: SimulationComponent[];
  /** Instruments that have NOT yet fired */
  activeInstruments: SimulationInstrument[];
  /** Record of fired triggers (for UI display) */
  triggeredEvents: TriggeredEvent[];
  /** Original cost basis for PnL calculation (immutable) */
  costBasis: bigint;
  /** Base token decimals */
  baseDecimals: number;
  /** Quote token decimals */
  quoteDecimals: number;
}

// ============================================================================
// TRIGGERED EVENT
// ============================================================================

export interface TriggeredEvent {
  /** ID of the instrument that fired */
  instrumentId: string;
  /** Instrument type (for display: 'stop_loss', 'take_profit') */
  instrumentType: string;
  /** Price at which the trigger condition was met */
  triggeredAtPrice: bigint;
  /** Portfolio total value right before the trigger fired */
  preTriggerValue: bigint;
  /** Portfolio total value right after the trigger fired */
  postTriggerValue: bigint;
}

// ============================================================================
// SIMULATION RESULT
// ============================================================================

export interface SimulationResult {
  /** Total portfolio value at the evaluated price */
  positionValue: bigint;
  /** PnL = positionValue - costBasis */
  pnlValue: bigint;
  /** PnL as percentage of cost basis (0.01% resolution) */
  pnlPercent: number;
  /** Base token amount held at this price */
  baseTokenAmount: bigint;
  /** Quote token amount held at this price */
  quoteTokenAmount: bigint;
  /** IDs of instruments that have been triggered so far */
  triggeredInstrumentIds: string[];
}

// ============================================================================
// CURVE POINT
// ============================================================================

export interface CurvePoint {
  price: bigint;
  positionValue: bigint;
  pnlValue: bigint;
  pnlPercent: number;
  baseTokenAmount: bigint;
  quoteTokenAmount: bigint;
  /** Whether any trigger has fired at or before this price point */
  hasTriggeredInstruments: boolean;
}
