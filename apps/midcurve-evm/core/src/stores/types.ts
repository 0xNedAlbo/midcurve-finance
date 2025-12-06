import type { Address, Hex } from 'viem';

/**
 * Pool state for updating PoolStore
 * Matches IPoolStore.PoolState from Solidity
 */
export interface PoolState {
  chainId: bigint;
  poolAddress: Address;
  token0: Address;
  token1: Address;
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  lastUpdated: bigint;
}

/**
 * Position state for updating PositionStore
 * Matches IPositionStore.PositionState from Solidity
 */
export interface PositionState {
  chainId: bigint;
  nftTokenId: bigint;
  poolId: Hex;
  owner: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  lastUpdated: bigint;
}

/**
 * Balance entry for updating BalanceStore
 */
export interface BalanceEntry {
  strategy: Address;
  chainId: bigint;
  token: Address;
  balance: bigint;
}

/**
 * External event types that trigger store updates
 */
export type ExternalEventType = 'ohlc' | 'pool' | 'position' | 'balance';

/**
 * OHLC candle data
 */
export interface OhlcCandle {
  timestamp: bigint;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

/**
 * Base interface for external events
 */
interface BaseExternalEvent {
  type: ExternalEventType;
}

/**
 * OHLC event from Hyperliquid
 * Note: OHLC data is delivered via callbacks only, no store update needed
 */
export interface OhlcEvent extends BaseExternalEvent {
  type: 'ohlc';
  marketId: Hex;
  timeframe: number;
  candle: OhlcCandle;
}

/**
 * Pool state update event from mainnet
 */
export interface PoolEvent extends BaseExternalEvent {
  type: 'pool';
  poolId: Hex;
  state: PoolState;
}

/**
 * Position state update event from mainnet
 */
export interface PositionEvent extends BaseExternalEvent {
  type: 'position';
  positionId: Hex;
  state: PositionState;
}

/**
 * Balance update event from mainnet
 */
export interface BalanceEvent extends BaseExternalEvent {
  type: 'balance';
  entry: BalanceEntry;
}

/**
 * Union of all external event types
 */
export type ExternalEvent = OhlcEvent | PoolEvent | PositionEvent | BalanceEvent;
