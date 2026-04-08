/**
 * UniswapV3 Vault Protocol-Specific Response Types
 *
 * These types define the exact shape of UniswapV3 vault position data after
 * BigIntToString transformation for API responses. They provide strong
 * typing for config and state fields.
 */

/**
 * UniswapV3 Vault Position Config as it appears in API responses.
 * All fields are JSON-safe (no bigint).
 */
export interface UniswapV3VaultPositionConfigResponse {
  chainId: number;
  vaultAddress: string;
  underlyingTokenId: number;
  factoryAddress: string;
  ownerAddress: string;
  poolAddress: string;
  token0Address: string;
  token1Address: string;
  feeBps: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  vaultDecimals: number;
  isToken0Quote: boolean;
  priceRangeLower: string;
  priceRangeUpper: string;
}

/**
 * UniswapV3 Vault Position State as it appears in API responses.
 * All bigint fields converted to strings.
 */
export interface UniswapV3VaultPositionStateResponse {
  sharesBalance: string;
  totalSupply: string;
  liquidity: string;
  unclaimedFees0: string;
  unclaimedFees1: string;
  isClosed: boolean;
  isOwnedByUser: boolean;
  sqrtPriceX96: string;
  currentTick: number;
  poolLiquidity: string;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}
