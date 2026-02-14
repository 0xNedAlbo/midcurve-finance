/**
 * Automation Service Types
 *
 * Barrel export for automation-related service types.
 */

export type {
  // Close order inputs
  RegisterCloseOrderInput,
  UpdateCloseOrderInput,
  FindCloseOrderOptions,
  MarkOrderRegisteredInput,
  MarkOrderTriggeredInput,
  MarkOrderExecutedInput,
  CreateFromOnChainEventInput,
  // Pool subscription inputs
  UpdatePoolSubscriptionInput,
  FindPoolSubscriptionOptions,
  // Automation log types - base contexts
  AutomationPlatform,
  BaseLogContext,
  EvmLogContext,
  SolanaLogContext,
  // Automation log types - order contexts (extend OrderLogContext)
  OrderLogContext,
  OrderCreatedContext,
  OrderRegisteredContext,
  OrderTriggeredContext,
  OrderExecutingContext,
  OrderExecutedContext,
  OrderFailedContext,
  RetryScheduledContext,
  OrderCancelledContext,
  OrderExpiredContext,
  OrderModifiedContext,
  PreflightValidationContext,
  SimulationFailedContext,
  // Automation log types - union and inputs
  AutomationLogContext,
  CreateAutomationLogInput,
  ListAutomationLogsOptions,
} from './automation-input.js';

export type {
  // Hedge vault types
  HedgeVaultState,
  HedgeVaultMonitoringStatus,
  HedgeVaultExecutionStatus,
  HedgeVaultTriggerType,
  // Hedge vault inputs
  RegisterHedgeVaultInput,
  UpdateHedgeVaultStateInput,
  RecordHedgeVaultExecutionInput,
  MarkExecutionCompletedInput,
  MarkExecutionFailedInput,
  FindHedgeVaultsOptions,
} from './hedge-vault-input.js';
