import type { Address, Hex } from 'viem';

/**
 * Represents a queued action waiting for execution
 */
export interface QueuedAction {
  /** Unique effect ID for tracking */
  effectId: Hex;

  /** The strategy that requested this action */
  strategyAddress: Address;

  /** The type of action (ADD_LIQUIDITY, REMOVE_LIQUIDITY, etc.) */
  actionType: Hex;

  /** ABI-encoded action payload */
  payload: Hex;

  /** Timestamp when the action was queued */
  queuedAt: number;
}

/**
 * Result of executing an effect
 */
export interface EffectResult {
  /** The effect ID that was executed */
  effectId: Hex;

  /** Whether the execution succeeded */
  success: boolean;

  /** Transaction hash (if executed on-chain) */
  txHash?: Hex;

  /** Error message if execution failed */
  errorMessage?: string;

  /** ABI-encoded result data for the callback */
  resultData: Hex;
}

/**
 * Interface for effect executors.
 * Implementations can be mock (for testing) or real (for mainnet execution).
 */
export interface IEffectExecutor {
  /**
   * Execute an action and return the result
   * @param action The queued action to execute
   * @returns The execution result
   */
  execute(action: QueuedAction): Promise<EffectResult>;
}

/**
 * Add liquidity action payload (decoded)
 */
export interface AddLiquidityPayload {
  effectId: Hex;
  poolId: Hex;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
}

/**
 * Remove liquidity action payload (decoded)
 */
export interface RemoveLiquidityPayload {
  effectId: Hex;
  positionId: Hex;
  liquidityAmount: bigint;
}

/**
 * Collect fees action payload (decoded)
 */
export interface CollectFeesPayload {
  effectId: Hex;
  positionId: Hex;
}

/**
 * Withdraw action payload (decoded)
 */
export interface WithdrawPayload {
  effectId: Hex;
  chainId: bigint;
  token: Address;
  amount: bigint;
}

/**
 * Add liquidity result data (for callback)
 */
export interface AddLiquidityResult {
  positionId: Hex;
  nftTokenId: bigint;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
}

/**
 * Remove liquidity result data (for callback)
 */
export interface RemoveLiquidityResult {
  amount0: bigint;
  amount1: bigint;
}

/**
 * Collect fees result data (for callback)
 */
export interface CollectFeesResult {
  amount0: bigint;
  amount1: bigint;
}

/**
 * Withdraw result data (for callback)
 */
export interface WithdrawResult {
  txHash: Hex;
}
