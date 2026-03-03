/**
 * Simulation Module
 *
 * Provides a stateful simulation engine with path memory for modeling
 * portfolio value changes as price moves through trigger thresholds.
 */

// Core interfaces
export type { SimulationComponent } from './simulation-component.js';
export type { SimulationInstrument, TriggerDirection } from './simulation-instrument.js';

// State and result types
export type {
  SimulationState,
  TriggeredEvent,
  SimulationResult,
  CurvePoint,
} from './simulation-state.js';

// Engine
export { SimulationEngine } from './simulation-engine.js';

// Components
export { SpotComponent } from './components/index.js';

// Instruments
export { ClosePositionInstrument } from './instruments/index.js';

// UniswapV3 integration
export {
  UniswapV3LPComponent,
  createUniswapV3SimulationEngine,
  type CreateSimulationEngineParams,
} from './uniswapv3/index.js';
