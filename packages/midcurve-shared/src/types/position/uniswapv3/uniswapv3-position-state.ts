/**
 * Uniswap V3 Position State
 *
 * Mutable state for Uniswap V3 positions.
 * This state changes as the position accrues fees and as liquidity is modified.
 *
 * State is kept as an interface (not a class) because:
 * - State has many bigint fields requiring serialization
 * - State is stored as immutable snapshots in database
 * - No business logic needed on state data
 * - Helper functions handle serialization
 */

// ============================================================================
// STATE INTERFACE
// ============================================================================

/**
 * UniswapV3PositionState
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

// ============================================================================
// JSON INTERFACE
// ============================================================================

/**
 * JSON representation for API responses.
 * All bigint fields converted to strings.
 */
export interface UniswapV3PositionStateJSON {
  ownerAddress: string;
  liquidity: string;
  feeGrowthInside0LastX128: string;
  feeGrowthInside1LastX128: string;
  tokensOwed0: string;
  tokensOwed1: string;
  unclaimedFees0: string;
  unclaimedFees1: string;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

/**
 * Convert state to JSON for API responses.
 * Converts all bigint values to strings.
 *
 * @param state - UniswapV3PositionState to serialize
 * @returns JSON-safe representation
 */
export function positionStateToJSON(
  state: UniswapV3PositionState
): UniswapV3PositionStateJSON {
  return {
    ownerAddress: state.ownerAddress,
    liquidity: state.liquidity.toString(),
    feeGrowthInside0LastX128: state.feeGrowthInside0LastX128.toString(),
    feeGrowthInside1LastX128: state.feeGrowthInside1LastX128.toString(),
    tokensOwed0: state.tokensOwed0.toString(),
    tokensOwed1: state.tokensOwed1.toString(),
    unclaimedFees0: state.unclaimedFees0.toString(),
    unclaimedFees1: state.unclaimedFees1.toString(),
  };
}

/**
 * Create state from JSON (database or API input).
 * Converts string values back to bigint.
 *
 * @param json - JSON representation to deserialize
 * @returns UniswapV3PositionState instance
 */
export function positionStateFromJSON(
  json: UniswapV3PositionStateJSON
): UniswapV3PositionState {
  return {
    ownerAddress: json.ownerAddress,
    liquidity: BigInt(json.liquidity),
    feeGrowthInside0LastX128: BigInt(json.feeGrowthInside0LastX128),
    feeGrowthInside1LastX128: BigInt(json.feeGrowthInside1LastX128),
    tokensOwed0: BigInt(json.tokensOwed0),
    tokensOwed1: BigInt(json.tokensOwed1),
    unclaimedFees0: BigInt(json.unclaimedFees0),
    unclaimedFees1: BigInt(json.unclaimedFees1),
  };
}
