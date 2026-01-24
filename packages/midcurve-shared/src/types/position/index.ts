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
  PositionType,
  PositionJSON,
  BasePositionParams,
  PositionRow,
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
  positionStateToJSON,
  positionStateFromJSON,
} from './uniswapv3/index.js';
