/**
 * Router Swap Quote API Types
 *
 * Types for fetching swap quotes from the MidcurveSwapRouter service.
 * Includes hop routes, fair value pricing, and deviation analysis.
 */

import { z } from 'zod';
import type { ApiResponse } from '../common/index.js';

// ============================================================================
// Hop Route Types
// ============================================================================

/**
 * A single hop in the swap route (display-friendly)
 */
export interface RouterSwapHop {
  /** Venue identifier (keccak256 of venue name) */
  venueId: string;

  /** Human-readable venue name (e.g. "UniswapV3") */
  venueName: string;

  /** Input token address for this hop */
  tokenIn: string;

  /** Input token symbol */
  tokenInSymbol: string;

  /** Output token address for this hop */
  tokenOut: string;

  /** Output token symbol */
  tokenOutSymbol: string;

  /** Fee tier in bps (e.g. 500 = 0.05%, 3000 = 0.3%) */
  feeTier: number;
}

/**
 * Encoded hop data for the MidcurveSwapRouter.sell() contract call
 */
export interface EncodedSwapHop {
  /** Venue identifier (bytes32) */
  venueId: string;

  /** Input token address */
  tokenIn: string;

  /** Output token address */
  tokenOut: string;

  /** Venue-specific encoded params (e.g. abi.encode(uint24 fee)) */
  venueData: string;
}

// ============================================================================
// Quote Diagnostics
// ============================================================================

/**
 * Router quote diagnostics for display
 */
export interface RouterQuoteDiagnostics {
  /** Number of paths enumerated by DFS */
  pathsEnumerated: number;

  /** Number of paths with valid quotes */
  pathsQuoted: number;

  /** Number of pools discovered */
  poolsDiscovered: number;
}

// ============================================================================
// Quote Response
// ============================================================================

/**
 * GET /api/v1/swap/router-quote - Response data
 *
 * Full swap quote from the MidcurveSwapRouter service.
 * Includes route, fair value, deviation analysis, and encoded hops for contract call.
 */
export interface RouterSwapQuoteData {
  /** Discriminant: 'execute' (swap possible) or 'do_not_execute' (conditions unfavorable) */
  kind: 'execute' | 'do_not_execute';

  /** Human-readable reason (only for do_not_execute) */
  reason?: string;

  /** Token being sold */
  tokenIn: string;

  /** Token being received */
  tokenOut: string;

  /** Exact amount of tokenIn to sell (raw units, as string for bigint) */
  amountIn: string;

  /** Best estimated output from local math quoting (raw units, as string) */
  estimatedAmountOut: string;

  /** Minimum acceptable output after deviation (raw units, as string) */
  minAmountOut: string;

  /** Fair value price ratio (tokenIn/tokenOut from CoinGecko), null if unavailable */
  fairValuePrice: number | null;

  /** Fair value output at 0% deviation (raw units, as string) */
  fairValueAmountOut: string;

  /** USD price of tokenIn, null if unavailable */
  tokenInUsdPrice: number | null;

  /** USD price of tokenOut, null if unavailable */
  tokenOutUsdPrice: number | null;

  /** Max deviation bps used for this quote (echoed back from input) */
  maxDeviationBps: number;

  /**
   * Actual deviation of estimated output from fair value (in bps).
   * Negative = estimate is below fair value.
   * Null if fair value is unavailable.
   */
  actualDeviationBps: number | null;

  /** Swap deadline (Unix timestamp, as string for bigint) */
  deadline: string;

  /** Ordered hop route for UI display */
  hops: RouterSwapHop[];

  /** Encoded hop data for MidcurveSwapRouter.sell() contract call */
  encodedHops: EncodedSwapHop[];

  /** MidcurveSwapRouter contract address (also the approval spender) */
  swapRouterAddress: string;

  /** Quote diagnostics */
  diagnostics: RouterQuoteDiagnostics;
}

/**
 * GET /api/v1/swap/router-quote - Response
 */
export type GetRouterSwapQuoteResponse = ApiResponse<RouterSwapQuoteData>;

// ============================================================================
// Query Params
// ============================================================================

/**
 * GET /api/v1/swap/router-quote - Query params
 */
export interface GetRouterSwapQuoteQuery {
  chainId: number;
  tokenIn: string;
  tokenInDecimals: number;
  tokenOut: string;
  tokenOutDecimals: number;
  amountIn: string;
  maxDeviationBps: number;
  maxHops?: number;
}

/**
 * GET /api/v1/swap/router-quote - Query validation
 */
export const GetRouterSwapQuoteQuerySchema = z.object({
  chainId: z.coerce
    .number()
    .int('Chain ID must be an integer')
    .positive('Chain ID must be positive'),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenIn address'),
  tokenInDecimals: z.coerce.number().int().min(0).max(18),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenOut address'),
  tokenOutDecimals: z.coerce.number().int().min(0).max(18),
  amountIn: z.string().min(1, 'Amount is required'),
  maxDeviationBps: z.coerce
    .number()
    .int()
    .min(1, 'Deviation must be at least 1 bps (0.01%)')
    .max(5000, 'Deviation cannot exceed 5000 bps (50%)'),
  maxHops: z.coerce.number().int().min(1).max(5).optional(),
});
