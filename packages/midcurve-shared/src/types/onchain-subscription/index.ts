/**
 * Onchain Data Subscription Types
 *
 * Re-exports all types and utilities for onchain event subscriptions.
 */

export type {
  OnchainSubscriptionType,
  OnchainSubscriptionStatus,
  OnchainSubscriptionData,
  OnchainSubscriptionJSON,
  Erc20ApprovalSubscriptionConfig,
  Erc20ApprovalSubscriptionState,
  Erc20ApprovalSubscriptionData,
  Erc20ApprovalSubscriptionJSON,
} from './types.js';

export {
  emptyErc20ApprovalState,
  subscriptionToJSON,
  subscriptionFromJSON,
  isErc20ApprovalSubscription,
  MAX_UINT256,
  isUnlimitedApproval,
  hasApproval,
} from './types.js';
