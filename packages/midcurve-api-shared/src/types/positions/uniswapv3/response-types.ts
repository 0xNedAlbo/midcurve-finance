/**
 * UniswapV3 Protocol-Specific Response Types
 *
 * These types define the exact shape of UniswapV3 position data after
 * BigIntToString transformation for API responses. They provide strong
 * typing for config and state fields.
 */

/**
 * UniswapV3 Position Config as it appears in API responses.
 * All fields are JSON-safe (no bigint).
 */
export interface UniswapV3PositionConfigResponse {
  chainId: number;
  nftId: number;
  poolAddress: string;
  tickUpper: number;
  tickLower: number;
}

/**
 * UniswapV3 Position State as it appears in API responses.
 * All bigint fields converted to strings.
 */
export interface UniswapV3PositionStateResponse {
  ownerAddress: string;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
  unclaimedFees0: string;
  unclaimedFees1: string;
}

/**
 * UniswapV3 Pool Config as it appears in API responses.
 */
export interface UniswapV3PoolConfigResponse {
  chainId: number;
  address: string;
  token0: string;
  token1: string;
  feeBps: number;
  tickSpacing: number;
}

/**
 * UniswapV3 Pool State as it appears in API responses.
 * All bigint fields converted to strings.
 */
export interface UniswapV3PoolStateResponse {
  sqrtPriceX96: string;
  currentTick: number;
  liquidity: string;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}

/**
 * ERC20 Token Config as it appears in API responses.
 */
export interface Erc20TokenConfigResponse {
  address: string;
  chainId: number;
}
