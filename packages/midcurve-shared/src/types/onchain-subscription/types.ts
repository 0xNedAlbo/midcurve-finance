/**
 * Onchain Data Subscription Types
 *
 * Types for managing WebSocket subscriptions to onchain events.
 * Used by midcurve-onchain-data worker and midcurve-api endpoints.
 */

// ============================================================================
// Base Types (all subscription types)
// ============================================================================

/**
 * Discriminator for subscription types.
 * Determines the schema of config and state JSON fields.
 */
export type OnchainSubscriptionType = 'erc20-approval';
// Future: | 'erc20-transfer' | 'nft-transfer' | 'pool-price';

/**
 * Subscription lifecycle status.
 */
export type OnchainSubscriptionStatus = 'active' | 'paused' | 'deleted';

/**
 * Base subscription data (common to all types).
 */
export interface OnchainSubscriptionData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  subscriptionType: OnchainSubscriptionType;
  subscriptionId: string;
  status: OnchainSubscriptionStatus;
  lastPolledAt: Date | null;
  pausedAt: Date | null;
  config: unknown;
  state: unknown;
}

/**
 * JSON representation for API responses.
 */
export interface OnchainSubscriptionJSON {
  id: string;
  createdAt: string;
  updatedAt: string;
  subscriptionType: OnchainSubscriptionType;
  subscriptionId: string;
  status: OnchainSubscriptionStatus;
  lastPolledAt: string | null;
  pausedAt: string | null;
  config: unknown;
  state: unknown;
}

// ============================================================================
// ERC-20 Approval Subscription Types
// ============================================================================

/**
 * Config for ERC-20 approval subscriptions (immutable after creation).
 */
export interface Erc20ApprovalSubscriptionConfig {
  /** EVM chain ID */
  chainId: number;
  /** ERC-20 token contract address (EIP-55 normalized) */
  tokenAddress: string;
  /** Owner address (the wallet that grants approval) */
  walletAddress: string;
  /** Spender address (the contract allowed to spend tokens) */
  spenderAddress: string;
  /** ISO 8601 timestamp when subscription was started */
  startedAt: string;
}

/**
 * State for ERC-20 approval subscriptions (mutable).
 */
export interface Erc20ApprovalSubscriptionState {
  /** Current approval amount (bigint as string) */
  approvalAmount: string;
  /** Block number of last Approval event */
  lastEventBlock: number | null;
  /** Transaction hash of last Approval event */
  lastEventTxHash: string | null;
  /** ISO 8601 timestamp of last state update */
  lastUpdatedAt: string;
}

/**
 * Complete ERC-20 approval subscription data.
 */
export interface Erc20ApprovalSubscriptionData extends Omit<OnchainSubscriptionData, 'config' | 'state'> {
  subscriptionType: 'erc20-approval';
  config: Erc20ApprovalSubscriptionConfig;
  state: Erc20ApprovalSubscriptionState;
}

/**
 * JSON representation for API responses.
 */
export interface Erc20ApprovalSubscriptionJSON extends Omit<OnchainSubscriptionJSON, 'config' | 'state'> {
  subscriptionType: 'erc20-approval';
  config: Erc20ApprovalSubscriptionConfig;
  state: Erc20ApprovalSubscriptionState;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an empty ERC-20 approval subscription state.
 */
export function emptyErc20ApprovalState(): Erc20ApprovalSubscriptionState {
  return {
    approvalAmount: '0',
    lastEventBlock: null,
    lastEventTxHash: null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Convert subscription data to JSON.
 */
export function subscriptionToJSON(data: OnchainSubscriptionData): OnchainSubscriptionJSON {
  return {
    id: data.id,
    createdAt: data.createdAt.toISOString(),
    updatedAt: data.updatedAt.toISOString(),
    subscriptionType: data.subscriptionType,
    subscriptionId: data.subscriptionId,
    status: data.status,
    lastPolledAt: data.lastPolledAt?.toISOString() ?? null,
    pausedAt: data.pausedAt?.toISOString() ?? null,
    config: data.config,
    state: data.state,
  };
}

/**
 * Convert JSON to subscription data.
 */
export function subscriptionFromJSON(json: OnchainSubscriptionJSON): OnchainSubscriptionData {
  return {
    id: json.id,
    createdAt: new Date(json.createdAt),
    updatedAt: new Date(json.updatedAt),
    subscriptionType: json.subscriptionType,
    subscriptionId: json.subscriptionId,
    status: json.status,
    lastPolledAt: json.lastPolledAt ? new Date(json.lastPolledAt) : null,
    pausedAt: json.pausedAt ? new Date(json.pausedAt) : null,
    config: json.config,
    state: json.state,
  };
}

/**
 * Type guard for ERC-20 approval subscription.
 */
export function isErc20ApprovalSubscription(
  data: OnchainSubscriptionData
): data is Erc20ApprovalSubscriptionData {
  return data.subscriptionType === 'erc20-approval';
}

/**
 * MAX_UINT256 constant for unlimited approval detection.
 */
export const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Check if an approval amount is unlimited (MAX_UINT256).
 */
export function isUnlimitedApproval(amount: string | bigint): boolean {
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  return amountBigInt >= MAX_UINT256;
}

/**
 * Check if approval amount is greater than zero.
 */
export function hasApproval(amount: string | bigint): boolean {
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
  return amountBigInt > 0n;
}
