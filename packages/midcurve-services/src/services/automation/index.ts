/**
 * Automation Services Index
 *
 * Re-exports all automation service classes and types.
 * These services handle position automation features:
 * - Close orders (price-triggered position closing)
 * - Pool subscriptions (price monitoring)
 * - Automation logs (user-facing event logs)
 *
 * Note: Shared contract addresses are loaded from JSON config files,
 * not from database. See apps/midcurve-automation/config/shared-contracts.json
 */

// Main services
export { CloseOrderService } from './close-order-service.js';
export type { CloseOrderServiceDependencies } from './close-order-service.js';

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
