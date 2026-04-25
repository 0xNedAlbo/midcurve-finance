/**
 * Position PnL Curve (per-position) Types
 *
 * Response shape for the GET /api/v1/positions/.../pnl-curve endpoints.
 * Returns the position's PnL curve over a price range — a flat list of
 * {price, value, pnl, pnlPercent, phase} points. This is the simple, no-order-overlay
 * shape consumed by the MCP server / general API clients; the richer
 * order-aware shape used by the UI lives in ./pnl-curve.ts.
 */

import type { ApiResponse } from '../../common/api-response.js';
import { z } from 'zod';

export interface PositionPnlCurvePoint {
  /** Price (raw bigint string, scaled to baseTokenDecimals). */
  price: string;
  /** Position value at this price in quote-token units (raw bigint string). */
  positionValue: string;
  /** Unrealized PnL = positionValue − costBasis (raw bigint string). */
  pnl: string;
  /** PnL percent (0.0001% resolution). */
  pnlPercent: number;
  /** Phase of the position at this price. */
  phase: 'below' | 'in-range' | 'above';
}

export interface PositionPnlCurveData {
  positionId: string;
  liquidity: string;
  costBasis: string;
  tickLower: number;
  tickUpper: number;
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  /** Current pool price (raw bigint string, scaled to baseTokenDecimals). */
  currentPrice: string;
  /** Echo of the price range used to generate the curve. */
  priceMin: string;
  priceMax: string;
  /** Number of points in the curve. */
  numPoints: number;
  curve: PositionPnlCurvePoint[];
}

export interface PositionPnlCurveResponse extends ApiResponse<PositionPnlCurveData> {
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Query parameter validation for the per-position /pnl-curve endpoints.
 * priceMin/priceMax are optional — when missing, the endpoint defaults to
 * ±50% around the position's current price.
 */
export const PositionPnlCurveQuerySchema = z.object({
  priceMin: z
    .string()
    .regex(/^\d+$/, 'priceMin must be a non-negative bigint string')
    .optional(),
  priceMax: z
    .string()
    .regex(/^\d+$/, 'priceMax must be a non-negative bigint string')
    .optional(),
  numPoints: z
    .string()
    .regex(/^\d+$/, 'numPoints must be a positive integer')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(2).max(200))
    .optional(),
});
