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
  UniswapV3PoolConfigResponse,
  UniswapV3PoolStateResponse,
  Erc20TokenConfigResponse,
} from './response-types.js';

/**
 * Erc20Token as it appears in API responses.
 */
/**
 * Token type matching @midcurve/shared TokenType
 */
export type TokenTypeResponse = 'erc20' | 'basic-currency';

export interface Erc20TokenResponse {
  id: string;
  tokenType: TokenTypeResponse;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  marketCap?: number;
  config: Erc20TokenConfigResponse;
  createdAt: string;
  updatedAt: string;
}

/**
 * UniswapV3Pool as it appears in API responses.
 */
export interface UniswapV3PoolResponse {
  id: string;
  protocol: 'uniswapv3';
  poolType: 'CL_TICKS';
  token0: Erc20TokenResponse;
  token1: Erc20TokenResponse;
  feeBps: number;
  config: UniswapV3PoolConfigResponse;
  state: UniswapV3PoolStateResponse;
  createdAt: string;
  updatedAt: string;
}

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
  protocol: 'uniswapv3';
  positionType: 'CL_TICKS';

  // Pool reference
  pool: UniswapV3PoolResponse;
  isToken0Quote: boolean;

  // PnL fields (bigint -> string)
  currentValue: string;
  currentCostBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  realizedCashflow: string;
  unrealizedCashflow: string;

  // Fee fields
  collectedFees: string;
  unClaimedFees: string;
  lastFeesCollectedAt: string;
  totalApr: number | null;

  // Price range (bigint -> string)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle
  positionOpenedAt: string;
  positionClosedAt: string | null;
  isActive: boolean;

  // Protocol-specific (STRONGLY TYPED)
  config: UniswapV3PositionConfigResponse;
  state: UniswapV3PositionStateResponse;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
