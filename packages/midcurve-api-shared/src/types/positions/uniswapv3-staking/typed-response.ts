/**
 * Strongly-typed UniswapV3StakingVault position response.
 *
 * Used by UI components consuming staking-vault position data from the API.
 * Replaces the loosely-typed `Record<string, unknown>` config/state fields
 * with protocol-specific interfaces.
 */

import type {
  UniswapV3StakingPositionConfigResponse,
  UniswapV3StakingPositionStateResponse,
} from './response-types.js';

import type { UniswapV3PoolResponse } from '../uniswapv3/typed-response.js';

/**
 * Complete UniswapV3 Staking Vault Position for API responses.
 */
export interface UniswapV3StakingPositionResponse {
  // Identity
  id: string;
  positionHash: string;
  userId: string;
  ownerWallet: string | null;
  protocol: 'uniswapv3-staking';
  type: string;

  // Pool reference (same underlying Uniswap V3 pool)
  pool: UniswapV3PoolResponse;
  isToken0Quote: boolean;

  // PnL fields (bigint → string)
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

  // Price range (bigint → string)
  priceRangeLower: string;
  priceRangeUpper: string;

  // Lifecycle
  positionOpenedAt: string;
  archivedAt: string | null;
  isArchived: boolean;

  // Protocol-specific (strongly typed)
  config: UniswapV3StakingPositionConfigResponse;
  state: UniswapV3StakingPositionStateResponse;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}
