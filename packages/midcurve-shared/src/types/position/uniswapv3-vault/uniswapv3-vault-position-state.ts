/**
 * UniswapV3 Vault Position State
 *
 * Mutable state for vault share positions.
 * Tracks the user's share balance, vault-level liquidity, and claimable fees.
 *
 * Key differences from UniswapV3PositionState:
 * - No fee accumulator internals (feePerShare, feeDebt) — the on-chain claimableYield()
 *   computes the full fee picture including all 4 components
 * - No isBurned (vault positions are always reopenable)
 * - User's liquidity is derived: liquidity * sharesBalance / totalSupply
 */

// ============================================================================
// STATE INTERFACE
// ============================================================================

export interface UniswapV3VaultPositionState {
  /** User's vault share token balance */
  sharesBalance: bigint;

  /** Total vault shares outstanding */
  totalSupply: bigint;

  /** Vault's total liquidity in the underlying NFT */
  liquidity: bigint;

  /**
   * User's claimable yield for token0.
   * Populated from vault.claimableYield(user) which computes the full picture on-chain:
   * pending + accumulator delta + tokensOwed (pro-rata) + unsnapshotted pool fees (pro-rata).
   */
  unclaimedFees0: bigint;

  /**
   * User's claimable yield for token1.
   * Populated from vault.claimableYield(user) — same 4-component calculation.
   */
  unclaimedFees1: bigint;

  /** Vault operator address (authorized to call tend/setOperator) */
  operatorAddress: string;

  /**
   * Whether the position is closed (sharesBalance == 0).
   * A closed vault position can be reopened by receiving shares.
   */
  isClosed: boolean;

  /** Whether the position is currently owned by the user */
  isOwnedByUser: boolean;

  // ---- Pool-level state (merged from pool, updated during refresh) ----

  /** Current sqrt(price) as Q64.96 fixed-point */
  sqrtPriceX96: bigint;

  /** Current tick of the pool */
  currentTick: number;

  /** Total liquidity currently in the pool */
  poolLiquidity: bigint;

  /** Global accumulated fees per unit of liquidity for token0 */
  feeGrowthGlobal0: bigint;

  /** Global accumulated fees per unit of liquidity for token1 */
  feeGrowthGlobal1: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3VaultPositionStateJSON {
  sharesBalance: string;
  totalSupply: string;
  liquidity: string;
  unclaimedFees0: string;
  unclaimedFees1: string;
  operatorAddress: string;
  isClosed: boolean;
  isOwnedByUser?: boolean;
  // Pool-level state (optional — present in DB JSON, omitted from API responses)
  sqrtPriceX96?: string;
  currentTick?: number;
  poolLiquidity?: string;
  feeGrowthGlobal0?: string;
  feeGrowthGlobal1?: string;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

export function vaultPositionStateToJSON(
  state: UniswapV3VaultPositionState
): UniswapV3VaultPositionStateJSON {
  return {
    sharesBalance: state.sharesBalance.toString(),
    totalSupply: state.totalSupply.toString(),
    liquidity: state.liquidity.toString(),
    unclaimedFees0: state.unclaimedFees0.toString(),
    unclaimedFees1: state.unclaimedFees1.toString(),
    operatorAddress: state.operatorAddress,
    isClosed: state.isClosed,
    isOwnedByUser: state.isOwnedByUser,
    // Pool-level fields intentionally omitted from API responses
  };
}

export function vaultPositionStateFromJSON(
  json: UniswapV3VaultPositionStateJSON
): UniswapV3VaultPositionState {
  return {
    sharesBalance: BigInt(json.sharesBalance),
    totalSupply: BigInt(json.totalSupply),
    liquidity: BigInt(json.liquidity),
    unclaimedFees0: BigInt(json.unclaimedFees0),
    unclaimedFees1: BigInt(json.unclaimedFees1),
    operatorAddress: json.operatorAddress,
    isClosed: json.isClosed,
    isOwnedByUser: json.isOwnedByUser ?? true,
    sqrtPriceX96: BigInt(json.sqrtPriceX96 ?? '0'),
    currentTick: json.currentTick ?? 0,
    poolLiquidity: BigInt(json.poolLiquidity ?? '0'),
    feeGrowthGlobal0: BigInt(json.feeGrowthGlobal0 ?? '0'),
    feeGrowthGlobal1: BigInt(json.feeGrowthGlobal1 ?? '0'),
  };
}
