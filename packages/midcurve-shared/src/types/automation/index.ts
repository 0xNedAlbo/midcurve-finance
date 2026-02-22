/**
 * Automation Types
 *
 * Type system for position automation features.
 * Protocol-agnostic types for close orders, triggers, and swaps.
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
// Close Order Config Types (protocol-agnostic)
// ============================================================================

export type {
  TriggerMode,
  SwapDirection,
  SwapConfig,
} from './close-order-config.types.js';
