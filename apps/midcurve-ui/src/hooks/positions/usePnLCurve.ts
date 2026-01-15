/**
 * React Query Hook for Position PnL Curve
 *
 * Fetches PnL curve data for a position, optionally including
 * the effects of automated close orders (stop-loss, take-profit).
 *
 * The curve shows position value and PnL across a range of prices,
 * with adjusted values when orders are active.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  PnLCurveResponse,
  PnLCurveResponseData,
} from '@midcurve/api-shared';
import { apiClient } from '@/lib/api-client';

/**
 * Options for the PnL curve query
 */
export interface UsePnLCurveOptions {
  /** Minimum price for visualization (bigint as string) */
  priceMin?: string;
  /** Maximum price for visualization (bigint as string) */
  priceMax?: string;
  /** Number of curve data points (default: 150) */
  numPoints?: number;
  /** Whether to include order effects (default: true) */
  includeOrders?: boolean;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

/**
 * Fetch PnL curve data for a position
 *
 * @param positionId - The database position ID
 * @param options - Query options including price range and point count
 * @returns React Query result with PnL curve response
 *
 * Response structure:
 * - data: PnLCurveResponseData - Complete curve data including:
 *   - Position metadata (ticks, liquidity, costBasis)
 *   - Token info (base and quote tokens)
 *   - Current state (price, tick)
 *   - Price range boundaries
 *   - Active orders affecting the curve
 *   - Array of curve points with raw and adjusted values
 * - meta: { timestamp, pointCount, orderCount, requestId }
 */
export function usePnLCurve(
  positionId: string | undefined,
  options: UsePnLCurveOptions = {}
): UseQueryResult<PnLCurveResponse, Error> {
  const {
    priceMin,
    priceMax,
    numPoints,
    includeOrders = true,
    enabled = true,
  } = options;

  return useQuery<PnLCurveResponse, Error>({
    queryKey: ['pnl-curve', positionId, priceMin, priceMax, numPoints, includeOrders],
    queryFn: async () => {
      if (!positionId) {
        throw new Error('Position ID is required');
      }

      // Build query string
      const params = new URLSearchParams();
      if (priceMin) params.set('priceMin', priceMin);
      if (priceMax) params.set('priceMax', priceMax);
      if (numPoints) params.set('numPoints', numPoints.toString());
      if (includeOrders !== undefined) params.set('includeOrders', includeOrders.toString());

      const queryString = params.toString();
      const url = `/api/v1/positions/${positionId}/pnl-curve${queryString ? `?${queryString}` : ''}`;

      const response = await apiClient.get<PnLCurveResponse>(url);

      return response as unknown as PnLCurveResponse;
    },
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 60 * 1000, // 1 minute
    enabled: enabled && !!positionId,
  });
}

/**
 * Helper to convert curve data to chart-friendly format
 *
 * Converts bigint strings to numbers for chart rendering while
 * preserving the original precision in separate fields.
 */
export function convertCurveDataForChart(
  data: PnLCurveResponseData,
  quoteDecimals: number
): {
  price: number;
  positionValue: number;
  adjustedValue: number;
  pnl: number;
  adjustedPnl: number;
  pnlPercent: number;
  adjustedPnlPercent: number;
  phase: string;
  orderTriggered?: string;
  profitZone: number | null;
  lossZone: number | null;
  adjustedProfitZone: number | null;
  adjustedLossZone: number | null;
}[] {
  const divisor = Math.pow(10, quoteDecimals);

  return data.curve.map((point) => {
    const pnl = Number(BigInt(point.pnl)) / divisor;
    const adjustedPnl = Number(BigInt(point.adjustedPnl)) / divisor;

    return {
      price: Number(BigInt(point.price)) / divisor,
      positionValue: Number(BigInt(point.positionValue)) / divisor,
      adjustedValue: Number(BigInt(point.adjustedValue)) / divisor,
      pnl,
      adjustedPnl,
      pnlPercent: point.pnlPercent,
      adjustedPnlPercent: point.adjustedPnlPercent,
      phase: point.phase,
      orderTriggered: point.orderTriggered,
      // For chart area fills
      profitZone: pnl > 0 ? pnl : null,
      lossZone: pnl < 0 ? pnl : null,
      adjustedProfitZone: adjustedPnl > 0 ? adjustedPnl : null,
      adjustedLossZone: adjustedPnl < 0 ? adjustedPnl : null,
    };
  });
}
