/**
 * Automation Service Types
 *
 * Barrel export for automation-related service types.
 */

// Close order inputs (CloseOrder + CloseOrderExecution)
export type {
  CreateCloseOrderInput,
  UpsertFromOnChainEventInput,
  SyncFromChainInput,
  FindCloseOrderOptions,
  CreateCloseOrderExecutionInput,
  MarkCloseOrderExecutionCompletedInput,
  MarkCloseOrderExecutionFailedInput,
} from './close-order-input.js';

// Pool subscription inputs
export type {
  UpdatePoolSubscriptionInput,
  FindPoolSubscriptionOptions,
} from './automation-input.js';

// Automation log types - base contexts
export type {
  AutomationPlatform,
  BaseLogContext,
  EvmLogContext,
  SolanaLogContext,
  // Order contexts (extend OrderLogContext)
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
  // Union and inputs
  AutomationLogContext,
  CreateAutomationLogInput,
  ListAutomationLogsOptions,
} from './automation-input.js';
