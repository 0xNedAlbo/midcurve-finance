/**
 * Position PnL Curve Types
 *
 * Types for the GET /api/v1/positions/:positionId/pnl-curve endpoint
 *
 * Returns PnL curve data points with optional order effects (stop-loss, take-profit)
 */

import type { ApiResponse } from '../../common/api-response.js';
import { z } from 'zod';

// =============================================================================
// Core Types
// =============================================================================

/**
 * Order type for display purposes
 */
export type PnLCurveOrderType = 'stop-loss' | 'take-profit';

/**
 * Order status for PnL curve display
 */
export type PnLCurveOrderStatus = 'active' | 'pending' | 'executed' | 'cancelled' | 'expired';

/**
 * Position phase at a price point
 */
export type PnLCurvePositionPhase = 'below' | 'in-range' | 'above';

/**
 * Serialized order info for API response
 */
export interface PnLCurveOrderData {
  /** Order type for display */
  type: PnLCurveOrderType;
  /** Trigger price in quote token units (bigint as string) */
  triggerPrice: string;
  /** Trigger tick (Uniswap V3 tick at trigger price) */
  triggerTick: number;
  /** Order status */
  status: PnLCurveOrderStatus;
  /** Position value at trigger price (bigint as string) */
  valueAtTrigger: string;
}

/**
 * Serialized curve point for API response
 */
export interface PnLCurvePointData {
  /** Price in quote token units (bigint as string) */
  price: string;
  /** Position value before order effects (bigint as string) */
  positionValue: string;
  /** Adjusted value after order effects (bigint as string) */
  adjustedValue: string;
  /** PnL before order effects (bigint as string) */
  pnl: string;
  /** Adjusted PnL after order effects (bigint as string) */
  adjustedPnl: string;
  /** PnL percentage before order effects */
  pnlPercent: number;
  /** Adjusted PnL percentage after order effects */
  adjustedPnlPercent: number;
  /** Position phase at this price */
  phase: PnLCurvePositionPhase;
  /** Which order (if any) triggers at this price point */
  orderTriggered?: PnLCurveOrderType;
}

/**
 * Token info for PnL curve response
 */
export interface PnLCurveTokenData {
  /** Token symbol */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** Token address (checksummed) */
  address: string;
}

/**
 * Complete PnL curve data for API response
 */
export interface PnLCurveResponseData {
  // Position metadata
  /** Position ID */
  positionId: string;
  /** Lower tick boundary */
  tickLower: number;
  /** Upper tick boundary */
  tickUpper: number;
  /** Position liquidity (bigint as string) */
  liquidity: string;
  /** Cost basis for PnL calculation (bigint as string) */
  costBasis: string;

  // Token info
  /** Base token information */
  baseToken: PnLCurveTokenData;
  /** Quote token information */
  quoteToken: PnLCurveTokenData;

  // Current state
  /** Current price in quote token units (bigint as string) */
  currentPrice: string;
  /** Current tick */
  currentTick: number;

  // Price range boundaries
  /** Lower price boundary (bigint as string) */
  lowerPrice: string;
  /** Upper price boundary (bigint as string) */
  upperPrice: string;

  // Orders
  /** Active orders affecting the curve */
  orders: PnLCurveOrderData[];

  // Curve data points
  /** Array of curve points */
  curve: PnLCurvePointData[];
}

// =============================================================================
// Request Types
// =============================================================================

/**
 * Path parameters for PnL curve endpoint
 */
export interface PnLCurvePathParams {
  positionId: string;
}

/**
 * Query parameters for PnL curve endpoint
 */
export interface PnLCurveQueryParams {
  /** Minimum price for visualization (bigint as string, optional) */
  priceMin?: string;
  /** Maximum price for visualization (bigint as string, optional) */
  priceMax?: string;
  /** Number of curve data points (default: 150) */
  numPoints?: number;
  /** Whether to include order effects (default: true) */
  includeOrders?: boolean;
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Response type for PnL curve endpoint
 */
export interface PnLCurveResponse extends ApiResponse<PnLCurveResponseData> {
  meta?: {
    timestamp: string;
    pointCount: number;
    orderCount: number;
    requestId?: string;
  };
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Path parameter validation schema
 */
export const PnLCurvePathParamsSchema = z.object({
  /**
   * Position ID (CUID)
   */
  positionId: z
    .string()
    .min(1, 'Position ID is required'),
});

/**
 * Query parameter validation schema
 */
export const PnLCurveQueryParamsSchema = z.object({
  /**
   * Minimum price for visualization (bigint as string)
   * Optional - defaults to -50% from position range
   */
  priceMin: z
    .string()
    .regex(/^\d+$/, 'priceMin must be a valid positive integer')
    .optional(),

  /**
   * Maximum price for visualization (bigint as string)
   * Optional - defaults to +50% from position range
   */
  priceMax: z
    .string()
    .regex(/^\d+$/, 'priceMax must be a valid positive integer')
    .optional(),

  /**
   * Number of curve data points
   * Default: 150, Min: 10, Max: 500
   */
  numPoints: z
    .string()
    .regex(/^\d+$/, 'numPoints must be a valid number')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().min(10).max(500))
    .optional(),

  /**
   * Whether to include order effects
   * Default: true
   */
  includeOrders: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
});

/**
 * Parsed query parameters type
 */
export type ParsedPnLCurveQueryParams = z.infer<typeof PnLCurveQueryParamsSchema>;
