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
  // Pool subscription inputs
  UpdatePoolSubscriptionInput,
  FindPoolSubscriptionOptions,
  // Automation log types
  AutomationPlatform,
  BaseLogContext,
  EvmLogContext,
  SolanaLogContext,
  OrderCreatedContext,
  OrderTriggeredContext,
  OrderExecutingContext,
  OrderExecutedContext,
  OrderFailedContext,
  OrderCancelledContext,
  PreflightValidationContext,
  SimulationFailedContext,
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
