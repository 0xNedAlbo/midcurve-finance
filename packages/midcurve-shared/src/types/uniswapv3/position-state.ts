/**
 * Uniswap V3 Position State
 *
 * Mutable state for Uniswap V3 positions.
 * This state changes as the position accrues fees and as liquidity is modified.
 */

/**
 * Uniswap V3 Position State
 *
 * Represents the current on-chain state of a Uniswap V3 position.
 */
export interface UniswapV3PositionState {
  /**
   * Owner address (wallet that owns the NFT)
   * EIP-55 checksummed address
   */
  ownerAddress: string;

  /**
   * Amount of liquidity in the position
   * Represents the amount of concentrated liquidity provided
   */
  liquidity: bigint;

  /**
   * Fee growth inside the position for token0
   * Tracks accumulated fees per unit of liquidity for token0
   * Q128.128 fixed point number
   */
  feeGrowthInside0LastX128: bigint;

  /**
   * Fee growth inside the position for token1
   * Tracks accumulated fees per unit of liquidity for token1
   * Q128.128 fixed point number
   */
  feeGrowthInside1LastX128: bigint;

  /**
   * Uncollected fees owed to the position in token0
   * Amount of token0 fees that can be collected
   */
  tokensOwed0: bigint;

  /**
   * Uncollected fees owed to the position in token1
   * Amount of token1 fees that can be collected
   */
  tokensOwed1: bigint;

  /**
   * Unclaimed fees in token0 (calculated from fee growth)
   * Total claimable amount including checkpointed and incremental fees
   * More accurate than tokensOwed0 as it includes fees earned since last checkpoint
   */
  unclaimedFees0: bigint;

  /**
   * Unclaimed fees in token1 (calculated from fee growth)
   * Total claimable amount including checkpointed and incremental fees
   * More accurate than tokensOwed1 as it includes fees earned since last checkpoint
   */
  unclaimedFees1: bigint;
}
