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
export type OnchainSubscriptionType =
  | 'erc20-approval'
  | 'erc20-balance'
  | 'evm-tx-status'
  | 'uniswapv3-pool-price';

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
// ERC-20 Balance Subscription Types
// ============================================================================

/**
 * Config for ERC-20 balance subscriptions (immutable after creation).
 */
export interface Erc20BalanceSubscriptionConfig {
  /** EVM chain ID */
  chainId: number;
  /** ERC-20 token contract address (EIP-55 normalized) */
  tokenAddress: string;
  /** Wallet address to watch balance for */
  walletAddress: string;
  /** ISO 8601 timestamp when subscription was started */
  startedAt: string;
}

/**
 * State for ERC-20 balance subscriptions (mutable).
 */
export interface Erc20BalanceSubscriptionState {
  /** Current balance (bigint as string) */
  balance: string;
  /** Block number of last Transfer event */
  lastEventBlock: number | null;
  /** Transaction hash of last Transfer event */
  lastEventTxHash: string | null;
  /** ISO 8601 timestamp of last state update */
  lastUpdatedAt: string;
}

/**
 * Complete ERC-20 balance subscription data.
 */
export interface Erc20BalanceSubscriptionData extends Omit<OnchainSubscriptionData, 'config' | 'state'> {
  subscriptionType: 'erc20-balance';
  config: Erc20BalanceSubscriptionConfig;
  state: Erc20BalanceSubscriptionState;
}

/**
 * JSON representation for API responses.
 */
export interface Erc20BalanceSubscriptionJSON extends Omit<OnchainSubscriptionJSON, 'config' | 'state'> {
  subscriptionType: 'erc20-balance';
  config: Erc20BalanceSubscriptionConfig;
  state: Erc20BalanceSubscriptionState;
}

// ============================================================================
// EVM Transaction Status Subscription Types
// ============================================================================

/**
 * Transaction status values.
 */
export type TxStatusValue = 'pending' | 'success' | 'reverted' | 'not_found';

/**
 * Config for EVM transaction status subscriptions (immutable after creation).
 */
export interface EvmTxStatusSubscriptionConfig {
  /** EVM chain ID */
  chainId: number;
  /** Transaction hash to monitor */
  txHash: string;
  /** Target confirmations before completion (default: 12) */
  targetConfirmations: number;
  /** ISO 8601 timestamp when subscription was started */
  startedAt: string;
}

/**
 * State for EVM transaction status subscriptions (mutable).
 */
export interface EvmTxStatusSubscriptionState {
  /** Current transaction status */
  status: TxStatusValue;
  /** Block number where tx was mined (null if pending) */
  blockNumber: number | null;
  /** Block hash where tx was mined */
  blockHash: string | null;
  /** Number of confirmations */
  confirmations: number;
  /** Gas used by the transaction (bigint as string) */
  gasUsed: string | null;
  /** Effective gas price paid (bigint as string) */
  effectiveGasPrice: string | null;
  /** Number of logs emitted */
  logsCount: number | null;
  /** Contract address if contract creation */
  contractAddress: string | null;
  /** ISO 8601 timestamp of last check */
  lastCheckedAt: string;
  /** Whether subscription is complete (status !== pending && confirmations >= target) */
  isComplete: boolean;
  /** ISO 8601 timestamp when subscription completed (for auto-delete) */
  completedAt: string | null;
}

/**
 * Complete EVM tx status subscription data.
 */
export interface EvmTxStatusSubscriptionData extends Omit<OnchainSubscriptionData, 'config' | 'state'> {
  subscriptionType: 'evm-tx-status';
  config: EvmTxStatusSubscriptionConfig;
  state: EvmTxStatusSubscriptionState;
}

/**
 * JSON representation for API responses.
 */
export interface EvmTxStatusSubscriptionJSON extends Omit<OnchainSubscriptionJSON, 'config' | 'state'> {
  subscriptionType: 'evm-tx-status';
  config: EvmTxStatusSubscriptionConfig;
  state: EvmTxStatusSubscriptionState;
}

// ============================================================================
// Uniswap V3 Pool Price Subscription Types
// ============================================================================

/**
 * Config for Uniswap V3 pool price subscriptions (immutable after creation).
 */
export interface UniswapV3PoolPriceSubscriptionConfig {
  /** EVM chain ID */
  chainId: number;
  /** Pool contract address (EIP-55 normalized) */
  poolAddress: string;
  /** ISO 8601 timestamp when subscription was started */
  startedAt: string;
}

/**
 * State for Uniswap V3 pool price subscriptions (mutable).
 */
export interface UniswapV3PoolPriceSubscriptionState {
  /** Current sqrtPriceX96 (bigint as string) */
  sqrtPriceX96: string;
  /** Current tick */
  tick: number;
  /** Block number of last Swap event */
  lastEventBlock: number | null;
  /** Transaction hash of last Swap event */
  lastEventTxHash: string | null;
  /** ISO 8601 timestamp of last state update */
  lastUpdatedAt: string;
}

/**
 * Complete Uniswap V3 pool price subscription data.
 */
export interface UniswapV3PoolPriceSubscriptionData
  extends Omit<OnchainSubscriptionData, 'config' | 'state'> {
  subscriptionType: 'uniswapv3-pool-price';
  config: UniswapV3PoolPriceSubscriptionConfig;
  state: UniswapV3PoolPriceSubscriptionState;
}

/**
 * JSON representation for API responses.
 */
export interface UniswapV3PoolPriceSubscriptionJSON
  extends Omit<OnchainSubscriptionJSON, 'config' | 'state'> {
  subscriptionType: 'uniswapv3-pool-price';
  config: UniswapV3PoolPriceSubscriptionConfig;
  state: UniswapV3PoolPriceSubscriptionState;
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
 * Create an empty ERC-20 balance subscription state.
 */
export function emptyErc20BalanceState(): Erc20BalanceSubscriptionState {
  return {
    balance: '0',
    lastEventBlock: null,
    lastEventTxHash: null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Type guard for ERC-20 balance subscription.
 */
export function isErc20BalanceSubscription(
  data: OnchainSubscriptionData
): data is Erc20BalanceSubscriptionData {
  return data.subscriptionType === 'erc20-balance';
}

/**
 * Create an empty EVM tx status subscription state.
 */
export function emptyEvmTxStatusState(): EvmTxStatusSubscriptionState {
  return {
    status: 'pending',
    blockNumber: null,
    blockHash: null,
    confirmations: 0,
    gasUsed: null,
    effectiveGasPrice: null,
    logsCount: null,
    contractAddress: null,
    lastCheckedAt: new Date().toISOString(),
    isComplete: false,
    completedAt: null,
  };
}

/**
 * Type guard for EVM tx status subscription.
 */
export function isEvmTxStatusSubscription(
  data: OnchainSubscriptionData
): data is EvmTxStatusSubscriptionData {
  return data.subscriptionType === 'evm-tx-status';
}

/**
 * Create an empty Uniswap V3 pool price subscription state.
 */
export function emptyUniswapV3PoolPriceState(): UniswapV3PoolPriceSubscriptionState {
  return {
    sqrtPriceX96: '0',
    tick: 0,
    lastEventBlock: null,
    lastEventTxHash: null,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Type guard for Uniswap V3 pool price subscription.
 */
export function isUniswapV3PoolPriceSubscription(
  data: OnchainSubscriptionData
): data is UniswapV3PoolPriceSubscriptionData {
  return data.subscriptionType === 'uniswapv3-pool-price';
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
