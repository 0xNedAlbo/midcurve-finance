/**
 * UniswapV3 Staking Vault Protocol-Specific Response Types
 *
 * Wire shapes for `UniswapV3StakingVault` position config + state after
 * BigIntToString transformation for API responses.
 */

/**
 * UniswapV3 Staking Position Config as it appears in API responses.
 * All fields are JSON-safe (no bigint).
 */
export interface UniswapV3StakingPositionConfigResponse {
  chainId: number;
  vaultAddress: string;
  factoryAddress: string;
  ownerAddress: string;
  underlyingTokenId: number;
  isToken0Quote: boolean;
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  feeBps: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  priceRangeLower: string;
  priceRangeUpper: string;
}

/**
 * UniswapV3 Staking Position State as it appears in API responses.
 * All bigint fields converted to strings.
 */
export interface UniswapV3StakingPositionStateResponse {
  vaultState: 'Empty' | 'Staked' | 'FlashCloseInProgress' | 'Settled';
  stakedBase: string;
  stakedQuote: string;
  yieldTarget: string;
  pendingBps: number;
  unstakeBufferBase: string;
  unstakeBufferQuote: string;
  rewardBufferBase: string;
  rewardBufferQuote: string;
  liquidity: string;
  isOwnedByUser: boolean;
  unclaimedYieldBase: string;
  unclaimedYieldQuote: string;
  sqrtPriceX96: string;
  currentTick: number;
  poolLiquidity: string;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}
