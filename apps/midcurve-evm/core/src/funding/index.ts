/**
 * Funding module for user-initiated deposits and withdrawals
 */

export * from './types.js';
export { FundingExecutor } from './funding-executor.js';
export { DepositWatcher, type OnDepositCallback } from './deposit-watcher.js';
export {
  FundingManager,
  type UpdateBalanceCallback,
  type NotifyStrategyCallback,
} from './funding-manager.js';
