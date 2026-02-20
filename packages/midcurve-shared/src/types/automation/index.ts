/**
 * Automation Types
 *
 * Type system for position automation features.
 * Includes on-chain close order types.
 */

// ============================================================================
// On-Chain Close Order Types (contract enum mirrors)
// ============================================================================

export {
  OnChainOrderStatus,
  ContractTriggerMode,
  ContractSwapDirection,
  AUTOMATION_STATES,
  type AutomationState,
} from './on-chain-close-order.types.js';

// ============================================================================
// UniswapV3 Types
// ============================================================================

export * from './uniswapv3/index.js';
