import type { Address, Hex } from 'viem';

// ============= Constants =============

/**
 * Sentinel address representing native ETH in BalanceStore
 * This is a widely-used convention in DeFi protocols
 */
export const ETH_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address;

// ============= Withdraw Types (Discriminated Union) =============

/**
 * Parameters for ERC-20 token withdrawal
 */
export interface Erc20WithdrawParams {
  /** Discriminator for type narrowing */
  type: 'erc20';
  /** The chain where tokens are held */
  chainId: bigint;
  /** The ERC-20 token address */
  token: Address;
  /** The amount to withdraw (in token decimals) */
  amount: bigint;
}

/**
 * Parameters for native ETH withdrawal
 */
export interface EthWithdrawParams {
  /** Discriminator for type narrowing */
  type: 'eth';
  /** The chain where ETH is held */
  chainId: bigint;
  /** The amount to withdraw (in wei) */
  amount: bigint;
}

/**
 * Union type for all withdrawal parameter types
 * Future: Add HyperliquidWithdrawParams, SolanaWithdrawParams, etc.
 */
export type WithdrawParams = Erc20WithdrawParams | EthWithdrawParams;

// ============= ETH Balance Update =============

/**
 * Parameters for ETH balance update request
 */
export interface EthBalanceUpdateParams {
  /** The chain to poll ETH balance from */
  chainId: bigint;
}

// ============= Request Tracking =============

/**
 * Base interface for all funding requests
 */
interface BaseFundingRequest {
  /** Unique request identifier (from strategy's _nextEffectId()) */
  requestId: Hex;
  /** The strategy that initiated this request */
  strategyAddress: Address;
  /** The owner address (recipient for withdrawals) */
  ownerAddress: Address;
  /** Timestamp when request was created */
  createdAt: number;
}

/**
 * Withdrawal request tracking
 */
export interface WithdrawRequest extends BaseFundingRequest {
  /** Operation type discriminator */
  operation: 'withdraw';
  /** Withdrawal parameters */
  params: WithdrawParams;
  /** Recipient address (always the owner) */
  recipient: Address;
}

/**
 * ETH balance update request tracking
 */
export interface EthBalanceUpdateRequest extends BaseFundingRequest {
  /** Operation type discriminator */
  operation: 'ethBalanceUpdate';
  /** Balance update parameters */
  params: EthBalanceUpdateParams;
}

/**
 * Union type for all funding request types
 */
export type FundingRequest = WithdrawRequest | EthBalanceUpdateRequest;

// ============= Decoded Events =============

/**
 * Decoded Erc20WithdrawRequested event
 */
export interface Erc20WithdrawRequestedEvent {
  type: 'Erc20WithdrawRequested';
  requestId: Hex;
  chainId: bigint;
  token: Address;
  amount: bigint;
  recipient: Address;
}

/**
 * Decoded EthWithdrawRequested event
 */
export interface EthWithdrawRequestedEvent {
  type: 'EthWithdrawRequested';
  requestId: Hex;
  chainId: bigint;
  amount: bigint;
  recipient: Address;
}

/**
 * Decoded EthBalanceUpdateRequested event
 */
export interface EthBalanceUpdateRequestedEvent {
  type: 'EthBalanceUpdateRequested';
  requestId: Hex;
  chainId: bigint;
}

/**
 * Union type for all decoded funding events
 */
export type FundingEvent =
  | Erc20WithdrawRequestedEvent
  | EthWithdrawRequestedEvent
  | EthBalanceUpdateRequestedEvent;

// ============= Execution Results =============

/**
 * Result of executing a funding operation
 */
export interface FundingResult {
  /** The request ID that was executed */
  requestId: Hex;
  /** Whether the operation succeeded */
  success: boolean;
  /** Transaction hash on external chain (if successful) */
  txHash?: Hex;
  /** Error message (if failed) */
  errorMessage?: string;
}

// ============= Deposit Detection =============

/**
 * Detected ERC-20 deposit (from Transfer event monitoring)
 */
export interface DetectedErc20Deposit {
  /** The chain where deposit was detected */
  chainId: bigint;
  /** The ERC-20 token address */
  token: Address;
  /** The amount deposited */
  amount: bigint;
  /** The sender address (user wallet) */
  from: Address;
  /** Transaction hash of the deposit */
  txHash: Hex;
  /** Block number of the deposit */
  blockNumber: bigint;
}

// ============= Balance Types =============

/**
 * Balance entry for a token on a chain
 */
export interface BalanceEntry {
  /** The chain ID */
  chainId: bigint;
  /** The token address (ETH_ADDRESS for native ETH) */
  token: Address;
  /** The balance amount */
  balance: bigint;
  /** When the balance was last updated */
  lastUpdated: bigint;
}

// ============= Chain Configuration =============

/**
 * Configuration for a supported external chain
 */
export interface ChainConfig {
  /** Chain ID */
  chainId: number;
  /** Human-readable chain name */
  name: string;
  /** RPC URL for connecting to this chain */
  rpcUrl: string;
}

// ============= Type Guards =============

/**
 * Check if withdraw params are for ERC-20 tokens
 */
export function isErc20Withdraw(
  params: WithdrawParams
): params is Erc20WithdrawParams {
  return params.type === 'erc20';
}

/**
 * Check if withdraw params are for native ETH
 */
export function isEthWithdraw(
  params: WithdrawParams
): params is EthWithdrawParams {
  return params.type === 'eth';
}

/**
 * Check if funding request is a withdrawal
 */
export function isWithdrawRequest(
  request: FundingRequest
): request is WithdrawRequest {
  return request.operation === 'withdraw';
}

/**
 * Check if funding request is an ETH balance update
 */
export function isEthBalanceUpdateRequest(
  request: FundingRequest
): request is EthBalanceUpdateRequest {
  return request.operation === 'ethBalanceUpdate';
}
