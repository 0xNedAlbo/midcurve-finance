/**
 * Automation Types
 *
 * Type system for position automation features.
 * Includes close orders, automation contracts, and pool subscriptions.
 *
 * ## Type Hierarchy
 *
 * ```
 * CloseOrderInterface
 *   └── BaseCloseOrder (abstract)
 *       └── UniswapV3CloseOrder (concrete)
 *           ├── UniswapV3CloseOrderConfig (class)
 *           └── UniswapV3CloseOrderState (class)
 *
 * AutomationContractInterface
 *   └── BaseAutomationContract (abstract)
 *       └── UniswapV3AutomationContract (concrete)
 *           ├── UniswapV3ContractConfig (class)
 *           └── UniswapV3ContractState (class)
 * ```
 */

// ============================================================================
// Close Order Types
// ============================================================================

export type {
  CloseOrderType,
  CloseOrderStatus,
  CloseOrderJSON,
  BaseCloseOrderParams,
  AutomationContractConfig,
} from './close-order.types.js';

export type { CloseOrderInterface } from './close-order.interface.js';

export { BaseCloseOrder } from './base-close-order.js';

// ============================================================================
// Automation Contract Types
// ============================================================================

export type {
  AutomationContractType,
  AutomationContractJSON,
  BaseAutomationContractParams,
} from './automation-contract.types.js';

export type { AutomationContractInterface } from './automation-contract.interface.js';

export { BaseAutomationContract } from './base-automation-contract.js';

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
// Factory
// ============================================================================

export {
  AutomationContractFactory,
  CloseOrderFactory,
  type AutomationContractRow,
  type CloseOrderRow,
} from './factory.js';

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
// Close Order Execution Types
// ============================================================================

export type { CloseOrderExecutionStatus } from './close-order-execution.types.js';

// ============================================================================
// UniswapV3 Types
// ============================================================================

export * from './uniswapv3/index.js';
