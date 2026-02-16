/**
 * SwapRouterService Types
 *
 * Types for computing optimal post-close swap parameters through MidcurveSwapRouter.
 */

import type { Address } from 'viem';
import type { SwapDirection } from '@midcurve/shared';

// ============================================================================
// Input Types
// ============================================================================

/**
 * Input for computing post-close swap parameters.
 * Called after a UniswapV3 position is closed to swap the unwanted token
 * into the user's target token.
 */
export interface PostCloseSwapInput {
  /** EVM chain ID */
  chainId: number;

  /** UniswapV3 position NFT ID (for position data lookup) */
  nftId: bigint;

  /** MidcurveSwapRouter contract address on this chain */
  swapRouterAddress: Address;

  /** Which token to sell: TOKEN0_TO_1 or TOKEN1_TO_0 */
  swapDirection: SwapDirection;

  /** User's max deviation from fair market value in basis points (e.g. 100 = 1%) */
  maxDeviationBps: number;

  /** Maximum number of hops in the swap path (default: 3) */
  maxHops?: number;

  /** Optional pre-fetched NFPM position data (avoids redundant RPC call) */
  positionData?: PositionDataInput;

  /** Optional pre-fetched pool sqrtPriceX96 (avoids redundant RPC call) */
  currentSqrtPriceX96?: bigint;
}

/**
 * Pre-fetched position data to avoid redundant NFPM reads.
 * The order executor already reads this data — pass it in to save an RPC call.
 */
export interface PositionDataInput {
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// ============================================================================
// Freeform Swap Input (UI Swap Dialog)
// ============================================================================

/**
 * Input for computing a freeform swap quote (no position context).
 * Used by the UI Swap Dialog where the user provides tokenIn/tokenOut/amount directly.
 */
export interface FreeformSwapInput {
  /** EVM chain ID */
  chainId: number;

  /** MidcurveSwapRouter contract address on this chain */
  swapRouterAddress: Address;

  /** Token to sell */
  tokenIn: Address;

  /** Decimals of tokenIn */
  tokenInDecimals: number;

  /** Token to receive */
  tokenOut: Address;

  /** Decimals of tokenOut */
  tokenOutDecimals: number;

  /** Exact amount of tokenIn to sell (in raw units) */
  amountIn: bigint;

  /** Max deviation from fair market value in basis points (e.g. 100 = 1%) */
  maxDeviationBps: number;

  /** Maximum number of hops in the swap path (default: 3) */
  maxHops?: number;
}

// ============================================================================
// Output Types (Discriminated Union)
// ============================================================================

/**
 * Result of computing a freeform swap quote.
 * Same discriminated union as PostCloseSwapResult.
 */
export type FreeformSwapResult = SwapInstruction | DoNotExecute;

/**
 * Result of computing post-close swap parameters.
 * Discriminated on `kind`:
 *   - 'execute': swap should proceed with the given instruction
 *   - 'do_not_execute': swap should NOT proceed (conditions unfavorable)
 */
export type PostCloseSwapResult = SwapInstruction | DoNotExecute;

/**
 * Swap should proceed with these parameters.
 */
export interface SwapInstruction {
  kind: 'execute';

  /** Token being sold */
  tokenIn: Address;

  /** Token being received */
  tokenOut: Address;

  /** Estimated input amount (with safety margin) */
  estimatedAmountIn: bigint;

  /** Minimum acceptable output amount (fair-value-based floor) */
  minAmountOut: bigint;

  /** Hop array for MidcurveSwapRouter.sell() */
  hops: SwapHop[];

  /** Unix timestamp deadline for the swap */
  deadline: bigint;

  /** Diagnostic information for logging */
  diagnostics: SwapDiagnostics;
}

/**
 * Swap should NOT proceed — conditions are unfavorable.
 * The order executor should retry via delay queue.
 */
export interface DoNotExecute {
  kind: 'do_not_execute';

  /** Human-readable reason for not executing */
  reason: string;

  /** Best swap path hops (when a path was found but conditions are unfavorable) */
  hops?: SwapHop[];

  /** Diagnostic information for logging */
  diagnostics: SwapDiagnostics;
}

// ============================================================================
// Hop Types (matches MidcurveSwapRouter Hop struct)
// ============================================================================

/**
 * A single hop in the swap path.
 * Matches the MidcurveSwapRouter's Hop struct exactly.
 */
export interface SwapHop {
  /** Venue identifier (e.g. keccak256("UniswapV3")) */
  venueId: `0x${string}`;

  /** Input token for this hop */
  tokenIn: Address;

  /** Output token for this hop */
  tokenOut: Address;

  /** Venue-specific encoded parameters (e.g. abi.encode(uint24 fee) for UniswapV3) */
  venueData: `0x${string}`;
}

// ============================================================================
// Internal Types (Pool Discovery & Path Enumeration)
// ============================================================================

/**
 * A discovered UniswapV3 pool with its current state.
 */
export interface DiscoveredPool {
  /** Pool contract address */
  address: Address;

  /** Token0 address (lower address) */
  token0: Address;

  /** Token1 address (higher address) */
  token1: Address;

  /** Fee tier (100, 500, 3000, 10000) */
  fee: number;

  /** Current in-range liquidity */
  liquidity: bigint;

  /** Current sqrtPriceX96 */
  sqrtPriceX96: bigint;
}

/**
 * A candidate swap path (ordered list of hops through pools).
 */
export interface CandidatePath {
  hops: PathHop[];
}

/**
 * A single hop within a candidate path.
 * Contains pool-level data needed for local math quoting.
 */
export interface PathHop {
  /** Pool address */
  poolAddress: Address;

  /** Token being sold in this hop */
  tokenIn: Address;

  /** Token being received in this hop */
  tokenOut: Address;

  /** Pool fee tier */
  fee: number;

  /** Pool's current sqrtPriceX96 */
  sqrtPriceX96: bigint;

  /** Pool's token0 address (needed to determine swap direction) */
  token0: Address;
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Diagnostic information attached to every result.
 * Useful for logging, debugging, and monitoring.
 */
export interface SwapDiagnostics {
  /** Number of candidate paths enumerated */
  pathsEnumerated: number;

  /** Number of paths that produced a non-zero estimate */
  pathsQuoted: number;

  /** Best estimated output amount from local math quoting */
  bestEstimatedAmountOut: bigint;

  /** Fair value price ratio (tokenIn/tokenOut in USD) */
  fairValuePrice: number | null;

  /** Absolute floor amount (fair value - maxDeviation) */
  absoluteFloorAmountOut: bigint;

  /** USD price of tokenIn */
  tokenInUsdPrice: number | null;

  /** USD price of tokenOut */
  tokenOutUsdPrice: number | null;

  /** Intermediary swap tokens discovered */
  intermediaryTokens: Address[];

  /** Number of pools discovered (backbone + edge) */
  poolsDiscovered: number;

  /** Whether backbone pools were served from cache */
  backbonePoolsCacheHit: boolean;

  /** Whether swap tokens were served from cache */
  swapTokensCacheHit: boolean;
}
