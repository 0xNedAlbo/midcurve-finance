/**
 * Position Simulation Types
 *
 * Response shape for the GET /api/v1/positions/.../simulate?price=… endpoints.
 * Returns a hypothetical snapshot of the position at the supplied price.
 */

import type { ApiResponse } from '../../common/api-response.js';
import { z } from 'zod';

export interface PositionSimulationData {
  /** Echo of the supplied price (raw bigint string, scaled to baseTokenDecimals). */
  price: string;
  /** Total position value in quote-token units at the simulated price (raw bigint string). */
  positionValue: string;
  /** Position value minus cost basis (raw bigint string). May be negative. */
  pnlValue: string;
  /** PnL percentage (0.0001% resolution, e.g. 12.34 = 12.34%). */
  pnlPercent: number;
  /** Base token held at this price (raw bigint string). */
  baseTokenAmount: string;
  /** Quote token held at this price (raw bigint string). */
  quoteTokenAmount: string;
  /** Phase of the position at this price. */
  phase: 'below' | 'in-range' | 'above';
  /** Token metadata so consumers can format without an extra call. */
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}

export interface PositionSimulationResponse extends ApiResponse<PositionSimulationData> {
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

/**
 * Query parameter validation for the /simulate endpoints.
 */
export const PositionSimulateQuerySchema = z.object({
  price: z
    .string()
    .regex(/^\d+$/, 'price must be a non-negative bigint string'),
});
