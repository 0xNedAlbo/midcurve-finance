/**
 * Automation Services Index
 *
 * Re-exports all automation service classes and types.
 * These services handle position automation features:
 * - Close orders (price-triggered position closing)
 * - Shared contracts (versioned contract registry)
 * - Pool subscriptions (price monitoring)
 * - Automation logs (user-facing event logs)
 */

// Main services
export { CloseOrderService } from './close-order-service.js';
export type { CloseOrderServiceDependencies } from './close-order-service.js';

export { SharedContractService } from './shared-contract-service.js';
export type { SharedContractServiceDependencies } from './shared-contract-service.js';

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
