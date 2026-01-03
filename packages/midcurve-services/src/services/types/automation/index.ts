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
} from './automation-input.js';
