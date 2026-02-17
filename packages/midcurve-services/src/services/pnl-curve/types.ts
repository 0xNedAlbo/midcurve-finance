/**
 * PnL Curve Service Types
 *
 * Types for PnL curve calculation with order integration.
 * Supports automated close orders (stop-loss, take-profit) that modify
 * the curve shape by "locking in" values at trigger prices.
 */

import type { PositionPhase } from '@midcurve/shared';

/**
 * Order type for display purposes
 *
 * Maps from TriggerMode to user-friendly terminology:
 * - LOWER trigger = stop-loss (price falling)
 * - UPPER trigger = take-profit (price rising)
 */
export type OrderType = 'stop-loss' | 'take-profit';

/**
 * Order status for PnL curve display
 */
export type OrderStatus = 'active' | 'pending' | 'executed' | 'cancelled' | 'expired';

/**
 * Simplified order info for PnL curve response
 */
export interface PnLCurveOrder {
  /** Order type for display */
  type: OrderType;
  /** Trigger price in quote token units (with decimals) */
  triggerPrice: bigint;
  /** Trigger tick (Uniswap V3 tick at trigger price) */
  triggerTick: number;
  /** Order status */
  status: OrderStatus;
  /** Position value at trigger price (quote token units) */
  valueAtTrigger: bigint;
}

/**
 * Single point on the PnL curve
 */
export interface PnLCurvePoint {
  /** Price in quote token units (with decimals) */
  price: bigint;
  /** Position value before order effects (quote token units) */
  positionValue: bigint;
  /** Adjusted value after order effects (quote token units) */
  adjustedValue: bigint;
  /** PnL before order effects (quote token units) */
  pnl: bigint;
  /** Adjusted PnL after order effects (quote token units) */
  adjustedPnl: bigint;
  /** PnL percentage before order effects */
  pnlPercent: number;
  /** Adjusted PnL percentage after order effects */
  adjustedPnlPercent: number;
  /** Position phase at this price */
  phase: PositionPhase;
  /** Which order (if any) triggers at this price point */
  orderTriggered?: OrderType;
}

/**
 * Token info for PnL curve response
 */
export interface PnLCurveTokenInfo {
  /** Token symbol */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** Token address (checksummed) */
  address: string;
}

/**
 * Complete PnL curve data
 */
export interface PnLCurveData {
  // Position metadata
  /** Position ID */
  positionId: string;
  /** Lower tick boundary */
  tickLower: number;
  /** Upper tick boundary */
  tickUpper: number;
  /** Position liquidity */
  liquidity: bigint;
  /** Cost basis for PnL calculation */
  costBasis: bigint;

  // Token info
  /** Base token information */
  baseToken: PnLCurveTokenInfo;
  /** Quote token information */
  quoteToken: PnLCurveTokenInfo;

  // Current state
  /** Current price in quote token units */
  currentPrice: bigint;
  /** Current tick */
  currentTick: number;

  // Price range boundaries
  /** Lower price boundary (quote token units) */
  lowerPrice: bigint;
  /** Upper price boundary (quote token units) */
  upperPrice: bigint;

  // Orders
  /** Active orders affecting the curve */
  orders: PnLCurveOrder[];

  // Curve data points
  /** Array of curve points */
  curve: PnLCurvePoint[];
}

/**
 * Input parameters for PnL curve generation
 */
export interface GeneratePnLCurveInput {
  /** Position ID to generate curve for */
  positionId: string;
  /** Minimum price for visualization (optional, defaults to -50% from range) */
  priceMin?: bigint;
  /** Maximum price for visualization (optional, defaults to +50% from range) */
  priceMax?: bigint;
  /** Number of curve data points (default: 150) */
  numPoints?: number;
  /** Whether to include order effects (default: true) */
  includeOrders?: boolean;
}

/**
 * Position data required for curve generation
 * (fetched from database)
 */
export interface PositionDataForCurve {
  id: string;
  protocol: string;
  isToken0Quote: boolean;
  currentCostBasis: string;
  pool: {
    id: string;
    protocol: string;
    feeBps: number;
    token0: {
      id: string;
      symbol: string;
      decimals: number;
      config: unknown;
    };
    token1: {
      id: string;
      symbol: string;
      decimals: number;
      config: unknown;
    };
    config: unknown;
    state: unknown;
  };
  config: unknown;
  state: unknown;
  onChainCloseOrders: {
    id: string;
    triggerMode: number;
    triggerTick: number | null;
    onChainStatus: number;
    monitoringState: string;
  }[];
}
