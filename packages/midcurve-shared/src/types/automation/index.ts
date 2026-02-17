/**
 * Automation Types
 *
 * Type system for position automation features.
 * Includes on-chain close order types and pool subscriptions.
 */

// ============================================================================
// Pool Subscription Types
// ============================================================================

export {
  type PoolPriceSubscriptionState,
  type PoolPriceSubscriptionData,
  type PoolPriceSubscriptionJSON,
  poolSubscriptionToJSON,
  poolSubscriptionFromJSON,
  emptySubscriptionState,
} from './pool-subscription.types.js';

// ============================================================================
// On-Chain Close Order Types (contract enum mirrors)
// ============================================================================

export {
  OnChainOrderStatus,
  ContractTriggerMode,
  ContractSwapDirection,
  type MonitoringState,
} from './on-chain-close-order.types.js';

// ============================================================================
// UniswapV3 Types
// ============================================================================

export * from './uniswapv3/index.js';
