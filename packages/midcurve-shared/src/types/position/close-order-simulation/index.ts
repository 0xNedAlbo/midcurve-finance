/**
 * Close Order Simulation Overlay Module
 *
 * Provides a decorator class for simulating take-profit and stop-loss
 * trigger behavior on top of any PositionInterface implementation.
 */

export {
  CloseOrderSimulationOverlay,
  INFINITE_RUNUP,
  type CloseOrderTriggerState,
  type CloseOrderSimulationOverlayParams,
  type PostTriggerExposure,
} from './close-order-simulation-overlay.js';
