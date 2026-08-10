/**
 * Strongly-Typed UniswapV3 Position Response
 *
 * This type provides full type safety for UI components consuming
 * UniswapV3 position data from the API. It replaces the loosely-typed
 * Record<string, unknown> fields with protocol-specific interfaces.
 */

import type {
  UniswapV3PositionConfigResponse,
  UniswapV3PositionStateResponse,
} from './response-types.js';

import type { UniswapV3PoolWire } from '../../pools/uniswapv3.js';

/**
 * Complete UniswapV3 Position for API responses.
 *
 * This is the fully-typed version of position data returned from the API.
 * Use this in UI components for full type safety when accessing
 * protocol-specific config and state fields.
 */
export interface UniswapV3PositionResponse {
  // Identity
  id: string;
  positionHash: string;
  userId: string;
  ownerWallet: string | null;
  protocol: 'uniswapv3';
  type: string;

  // Pool reference
  //
  // The same wire shape the pool endpoints return, not a parallel description of
  // it: `serializeUniswapV3Position` nests `serializeUniswapV3Pool`, so these are
  // the same bytes. A second declaration here would drift from that one.
  pool: UniswapV3PoolWire;
  isToken0Quote: boolean;

  // PnL fields (bigint -> string)
  currentValue: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;

  // Yield fields
  collectedYield: string;
  unclaimedYield: string;
  lastYieldClaimedAt: string;
  totalApr: number | null;
  baseApr: number | null;
  rewardApr: number | null;

  // Price range (bigint -> string)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle
  positionOpenedAt: string;
  archivedAt: string | null;
  isArchived: boolean;

  // Protocol-specific (STRONGLY TYPED)
  config: UniswapV3PositionConfigResponse;
  state: UniswapV3PositionStateResponse;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
