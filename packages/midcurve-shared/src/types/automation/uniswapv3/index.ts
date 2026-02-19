/**
 * UniswapV3 Automation Types
 *
 * Exports UniswapV3-specific automation type definitions.
 */

export type {
  TriggerMode,
  SwapDirection,
  SwapConfig,
} from './uniswapv3-close-order-config.js';

export type {
  UniswapV3CloseOrderConfig,
  UniswapV3CloseOrderState,
  UniswapV3CloseOrderExecutionConfig,
  UniswapV3CloseOrderExecutionState,
} from './uniswapv3-close-order.js';

export {
  createUniswapV3OrderIdentityHash,
  createEmptyUniswapV3CloseOrderState,
  createEmptyUniswapV3ExecutionState,
} from './uniswapv3-close-order.js';
