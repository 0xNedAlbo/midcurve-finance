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
  isClosed: boolean;
  isBurned: boolean;
  isOwnedByUser: boolean;
}

// The pool's config, state and token shapes are NOT redeclared here. They are
// the serialized shapes of the UniswapV3Pool / Erc20Token classes, so they live
// beside those classes in @midcurve/shared (UniswapV3PoolConfigJSON,
// UniswapV3PoolStateJSON, Erc20TokenConfigJSON) and reach API consumers via
// UniswapV3PoolWire. Field-identical copies here drifted from the serializer
// once already — see issue #57.
