/**
 * Strongly-Typed UniswapV3 Vault Position Response
 *
 * This type provides full type safety for UI components consuming
 * UniswapV3 vault position data from the API. It replaces the loosely-typed
 * Record<string, unknown> fields with protocol-specific interfaces.
 */

import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from './response-types.js';

import type { UniswapV3PoolResponse } from '../uniswapv3/typed-response.js';

/**
 * Complete UniswapV3 Vault Position for API responses.
 *
 * This is the fully-typed version of vault position data returned from the API.
 * Use this in UI components for full type safety when accessing
 * protocol-specific config and state fields.
 */
export interface UniswapV3VaultPositionResponse {
  // Identity
  id: string;
  positionHash: string;
  userId: string;
  ownerWallet: string | null;
  protocol: 'uniswapv3-vault';
  type: string;

  // Pool reference (same underlying Uniswap V3 pool)
  pool: UniswapV3PoolResponse;
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
  positionClosedAt: string | null;
  isActive: boolean;

  // Protocol-specific (STRONGLY TYPED)
  config: UniswapV3VaultPositionConfigResponse;
  state: UniswapV3VaultPositionStateResponse;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
