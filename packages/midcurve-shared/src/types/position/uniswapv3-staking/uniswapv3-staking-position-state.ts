/**
 * UniswapV3 Staking Position State
 *
 * Mutable state for UniswapV3StakingVault positions, refreshed on read.
 * Mirrors the on-chain `state()` lifecycle plus the four settlement buffers
 * (informational — buffers are drained via unstake()/claimRewards() and do
 * not affect cost-basis directly).
 */

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * On-chain lifecycle of the staking vault.
 * Mirrors `enum State` in UniswapV3StakingVault.sol.
 */
export type StakingState = 'Empty' | 'Staked' | 'FlashCloseInProgress' | 'Settled';

// ============================================================================
// STATE INTERFACE
// ============================================================================

export interface UniswapV3StakingPositionState {
  /** On-chain vault state */
  vaultState: StakingState;

  /** Stake terms (immutable while Staked, refreshed on top-up) */
  stakedBase: bigint;
  stakedQuote: bigint;
  yieldTarget: bigint;
  pendingBps: number;

  /** Settlement buffers (informational — drained by unstake/claimRewards) */
  unstakeBufferBase: bigint;
  unstakeBufferQuote: bigint;
  rewardBufferBase: bigint;
  rewardBufferQuote: bigint;

  /** Underlying NFT state */
  liquidity: bigint;
  isOwnedByUser: boolean;

  /** Computed live yield (claimable on next swap) */
  unclaimedYieldBase: bigint;
  unclaimedYieldQuote: bigint;

  /** Pool snapshot at last refresh */
  sqrtPriceX96: bigint;
  currentTick: number;
  poolLiquidity: bigint;
  feeGrowthGlobal0: bigint;
  feeGrowthGlobal1: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3StakingPositionStateJSON {
  vaultState: StakingState;
  stakedBase: string;
  stakedQuote: string;
  yieldTarget: string;
  pendingBps: number;
  unstakeBufferBase: string;
  unstakeBufferQuote: string;
  rewardBufferBase: string;
  rewardBufferQuote: string;
  liquidity: string;
  isOwnedByUser?: boolean;
  unclaimedYieldBase: string;
  unclaimedYieldQuote: string;
  sqrtPriceX96?: string;
  currentTick?: number;
  poolLiquidity?: string;
  feeGrowthGlobal0?: string;
  feeGrowthGlobal1?: string;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

export function stakingPositionStateToJSON(
  state: UniswapV3StakingPositionState,
): UniswapV3StakingPositionStateJSON {
  return {
    vaultState: state.vaultState,
    stakedBase: state.stakedBase.toString(),
    stakedQuote: state.stakedQuote.toString(),
    yieldTarget: state.yieldTarget.toString(),
    pendingBps: state.pendingBps,
    unstakeBufferBase: state.unstakeBufferBase.toString(),
    unstakeBufferQuote: state.unstakeBufferQuote.toString(),
    rewardBufferBase: state.rewardBufferBase.toString(),
    rewardBufferQuote: state.rewardBufferQuote.toString(),
    liquidity: state.liquidity.toString(),
    isOwnedByUser: state.isOwnedByUser,
    unclaimedYieldBase: state.unclaimedYieldBase.toString(),
    unclaimedYieldQuote: state.unclaimedYieldQuote.toString(),
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    currentTick: state.currentTick,
    poolLiquidity: state.poolLiquidity.toString(),
    feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
    feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
  };
}

export function stakingPositionStateFromJSON(
  json: UniswapV3StakingPositionStateJSON,
): UniswapV3StakingPositionState {
  return {
    vaultState: json.vaultState,
    stakedBase: BigInt(json.stakedBase),
    stakedQuote: BigInt(json.stakedQuote),
    yieldTarget: BigInt(json.yieldTarget),
    pendingBps: json.pendingBps,
    unstakeBufferBase: BigInt(json.unstakeBufferBase),
    unstakeBufferQuote: BigInt(json.unstakeBufferQuote),
    rewardBufferBase: BigInt(json.rewardBufferBase),
    rewardBufferQuote: BigInt(json.rewardBufferQuote),
    liquidity: BigInt(json.liquidity),
    isOwnedByUser: json.isOwnedByUser ?? true,
    unclaimedYieldBase: BigInt(json.unclaimedYieldBase),
    unclaimedYieldQuote: BigInt(json.unclaimedYieldQuote),
    sqrtPriceX96: BigInt(json.sqrtPriceX96 ?? '0'),
    currentTick: json.currentTick ?? 0,
    poolLiquidity: BigInt(json.poolLiquidity ?? '0'),
    feeGrowthGlobal0: BigInt(json.feeGrowthGlobal0 ?? '0'),
    feeGrowthGlobal1: BigInt(json.feeGrowthGlobal1 ?? '0'),
  };
}
