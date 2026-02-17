/**
 * Automation Services Index
 *
 * Re-exports all automation service classes and types.
 * These services handle position automation features:
 * - On-chain close orders (price-triggered position closing)
 * - Close order executions (individual execution attempt tracking)
 * - Shared contracts (versioned contract registry)
 * - Pool subscriptions (price monitoring)
 * - Automation logs (user-facing event logs)
 * - Hedge vaults (automated LP management)
 */

// On-chain close order service (replaces old CloseOrderService)
export { OnChainCloseOrderService } from './on-chain-close-order-service.js';
export type {
  OnChainCloseOrderServiceDependencies,
  OnChainCloseOrderWithPosition,
} from './on-chain-close-order-service.js';

// Close order execution service
export { CloseOrderExecutionService } from './close-order-execution-service.js';
export type { CloseOrderExecutionServiceDependencies } from './close-order-execution-service.js';

export { SharedContractService } from './shared-contract-service.js';
export type {
  SharedContractServiceDependencies,
  UpsertSharedContractInput,
} from './shared-contract-service.js';

export { PoolSubscriptionService } from './pool-subscription-service.js';
export type { PoolSubscriptionServiceDependencies } from './pool-subscription-service.js';

export {
  AutomationLogService,
  LogLevel,
  AutomationLogType,
} from './automation-log-service.js';
export type {
  AutomationLogServiceDependencies,
  ListAutomationLogsResult,
  LogLevelType,
  AutomationLogTypeValue,
} from './automation-log-service.js';

export { HedgeVaultService } from './hedge-vault-service.js';
export type {
  HedgeVaultServiceDependencies,
  HedgeVaultWithExecutions,
} from './hedge-vault-service.js';
