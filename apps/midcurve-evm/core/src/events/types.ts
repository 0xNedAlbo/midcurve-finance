import type { Hex, Log } from 'viem';
import { keccak256, toHex } from 'viem';
import { LogLevel } from '../utils/logger.js';

/**
 * Compute keccak256 hash of a string (for event signatures)
 */
function eventSignature(sig: string): Hex {
  return keccak256(toHex(sig));
}

/**
 * Event topics (keccak256 hashes of event signatures)
 */
export const EVENT_TOPICS = {
  // SubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
  SUBSCRIPTION_REQUESTED: eventSignature(
    'SubscriptionRequested(bytes32,bytes)'
  ),

  // UnsubscriptionRequested(bytes32 indexed subscriptionType, bytes payload)
  UNSUBSCRIPTION_REQUESTED: eventSignature(
    'UnsubscriptionRequested(bytes32,bytes)'
  ),

  // ActionRequested(bytes32 indexed actionType, bytes payload)
  ACTION_REQUESTED: eventSignature('ActionRequested(bytes32,bytes)'),

  // LogMessage(LogLevel indexed level, string message, bytes data)
  // LogLevel is an enum which is uint8 in the ABI
  LOG_MESSAGE: eventSignature('LogMessage(uint8,string,bytes)'),

  // Strategy lifecycle events (from IStrategy interface)
  // StrategyStarted() - emitted when strategy transitions to Running state
  STRATEGY_STARTED: eventSignature('StrategyStarted()'),

  // StrategyShutdown() - emitted when strategy transitions to Shutdown state
  STRATEGY_SHUTDOWN: eventSignature('StrategyShutdown()'),

  // Funding events (from IFunding interface)
  // EthBalanceUpdateRequested(bytes32 indexed requestId, uint256 indexed chainId)
  ETH_BALANCE_UPDATE_REQUESTED: eventSignature(
    'EthBalanceUpdateRequested(bytes32,uint256)'
  ),
} as const;

/**
 * Subscription type identifiers (keccak256 hashes)
 */
export const SUBSCRIPTION_TYPES = {
  // keccak256("Subscription:Ohlc:v1")
  OHLC: keccak256(toHex('Subscription:Ohlc:v1')),

  // keccak256("Subscription:Pool:v1")
  POOL: keccak256(toHex('Subscription:Pool:v1')),

  // keccak256("Subscription:Position:v1")
  POSITION: keccak256(toHex('Subscription:Position:v1')),

  // keccak256("Subscription:Balance:v1")
  BALANCE: keccak256(toHex('Subscription:Balance:v1')),
} as const;

/**
 * Action type identifiers (keccak256 hashes)
 */
export const ACTION_TYPES = {
  // keccak256("Action:UniswapV3:AddLiquidity:v1")
  ADD_LIQUIDITY: keccak256(toHex('Action:UniswapV3:AddLiquidity:v1')),

  // keccak256("Action:UniswapV3:RemoveLiquidity:v1")
  REMOVE_LIQUIDITY: keccak256(toHex('Action:UniswapV3:RemoveLiquidity:v1')),

  // keccak256("Action:UniswapV3:CollectFees:v1")
  COLLECT_FEES: keccak256(toHex('Action:UniswapV3:CollectFees:v1')),

  // keccak256("Action:Funding:Withdraw:v1")
  WITHDRAW: keccak256(toHex('Action:Funding:Withdraw:v1')),
} as const;

/**
 * Decoded subscription request event
 */
export interface SubscriptionRequestedEvent {
  type: 'SubscriptionRequested';
  subscriptionType: Hex;
  payload: Hex;
  log: Log;
}

/**
 * Decoded unsubscription request event
 */
export interface UnsubscriptionRequestedEvent {
  type: 'UnsubscriptionRequested';
  subscriptionType: Hex;
  payload: Hex;
  log: Log;
}

/**
 * Decoded action request event
 */
export interface ActionRequestedEvent {
  type: 'ActionRequested';
  actionType: Hex;
  payload: Hex;
  log: Log;
}

/**
 * Decoded log message event
 */
export interface LogMessageEvent {
  type: 'LogMessage';
  level: LogLevel;
  message: string;
  data: Hex;
  log: Log;
}

/**
 * Decoded ETH balance update request event
 */
export interface EthBalanceUpdateRequestedEvent {
  type: 'EthBalanceUpdateRequested';
  requestId: Hex;
  chainId: bigint;
  log: Log;
}

/**
 * Union of all decoded event types
 */
export type DecodedEvent =
  | SubscriptionRequestedEvent
  | UnsubscriptionRequestedEvent
  | ActionRequestedEvent
  | LogMessageEvent
  | EthBalanceUpdateRequestedEvent;

/**
 * Unknown log that couldn't be decoded
 */
export interface UnknownLog {
  type: 'Unknown';
  log: Log;
}

/**
 * Result of decoding a log - either a known event or unknown
 */
export type DecodeResult = DecodedEvent | UnknownLog;

/**
 * Strategy state enum (matches IStrategy.StrategyState in Solidity)
 */
export enum StrategyState {
  Created = 0,
  Running = 1,
  Shutdown = 2,
}

/**
 * ABI for strategy lifecycle events
 */
export const STRATEGY_LIFECYCLE_ABI = [
  {
    type: 'event',
    name: 'StrategyStarted',
    inputs: [],
  },
  {
    type: 'event',
    name: 'StrategyShutdown',
    inputs: [],
  },
  {
    type: 'function',
    name: 'state',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

/**
 * ABI for funding events (EthBalanceUpdateRequested)
 */
export const FUNDING_EVENTS_ABI = [
  {
    type: 'event',
    name: 'EthBalanceUpdateRequested',
    inputs: [
      { name: 'requestId', type: 'bytes32', indexed: true },
      { name: 'chainId', type: 'uint256', indexed: true },
    ],
  },
] as const;
