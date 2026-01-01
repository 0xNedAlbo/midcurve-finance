/**
 * Automation Service Types
 *
 * Barrel export for automation-related service types.
 */

export type {
  // Contract inputs
  DeployContractInput,
  UpdateContractDeploymentInput,
  FindContractOptions,
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
