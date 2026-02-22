/**
 * Position Module Exports
 *
 * Re-exports all position types, classes, and utilities.
 *
 * This module provides the OOP inheritance pattern for positions:
 * - PositionInterface: Contract for all position implementations
 * - BasePosition: Abstract base class with common functionality
 * - UniswapV3Position: Concrete implementation for Uniswap V3
 * - PositionFactory: Factory for creating positions from database rows
 */

// Interface
export type { PositionInterface } from './position.interface.js';

// Types
export type {
  PositionProtocol,
  PositionJSON,
  BasePositionParams,
  PositionRow,
  PnLSimulationResult,
} from './position.types.js';

// Base class
export { BasePosition } from './base-position.js';

// Factory
export { PositionFactory } from './factory.js';

// Uniswap V3 specific
export {
  UniswapV3Position,
  UniswapV3PositionConfig,
  type UniswapV3PositionParams,
  type UniswapV3PositionRow,
  type UniswapV3PositionConfigData,
  type UniswapV3PositionConfigJSON,
  type UniswapV3PositionState,
  type UniswapV3PositionStateJSON,
  type UniswapV3PositionMetrics,
  type UniswapV3PositionPnLSummary,
  type UniswapV3PnLSimulationResult,
  type UniswapV3SimulationParams,
  positionStateToJSON,
  positionStateFromJSON,
} from './uniswapv3/index.js';

// Simulation overlay
export {
  CloseOrderSimulationOverlay,
  INFINITE_RUNUP,
  type PnLScenario,
  type CloseOrderSimulationOverlayParams,
  type PostTriggerExposure,
} from './close-order-simulation/index.js';

// Import for use in type alias
import type { UniswapV3Position as UniswapV3PositionType } from './uniswapv3/index.js';

/**
 * Union type for all position implementations.
 * Extend this as new protocols are added (Orca, Raydium, etc.)
 */
export type AnyPosition = UniswapV3PositionType;
