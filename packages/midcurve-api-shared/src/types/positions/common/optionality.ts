/**
 * Position Optionality Types
 *
 * Types for the GET /api/v1/positions/uniswapv3/:chainId/:nftId/optionality endpoint
 *
 * Reframes LP position activity in options terminology:
 * - Net rebalancing: how much base was bought/sold and at what VWAP
 * - Premium: fees earned for providing liquidity
 * - Market comparison: position outcome vs. current spot price
 */

import type { ApiResponse } from '../../common/api-response.js';

// =============================================================================
// Summary Types
// =============================================================================

/**
 * Aggregated optionality summary for a position.
 */
export interface OptionalitySummaryData {
  // --- Net deposits (liquidity event totals) ---
  netDepositBase: string;
  netDepositQuote: string;
  /** VWAP of deposits/withdrawals at spot price. "0" if no base deposited */
  netDepositAvgPrice: string;

  // --- AMM rebalancing aggregates (separate buy/sell) ---
  /** Total base token bought by AMM (positive, raw units) */
  ammBoughtBase: string;
  /** VWAP for AMM buys (quote per base, raw units). "0" if no buys */
  ammBoughtAvgPrice: string;
  /** Premium earned on buy segments (quote token raw units) */
  ammBoughtPremium: string;

  /** Total base token sold by AMM (positive, raw units) */
  ammSoldBase: string;
  /** VWAP for AMM sells (quote per base, raw units). "0" if no sells */
  ammSoldAvgPrice: string;
  /** Premium earned on sell segments (quote token raw units) */
  ammSoldPremium: string;

  // --- Net rebalancing (aggregated across all segments) ---
  /** Signed net base delta across all rebalancing segments (negative = net sold) */
  netRebalancingBase: string;
  /** Signed net quote delta across all rebalancing segments */
  netRebalancingQuote: string;
  /** VWAP: |netQuote| * 10^baseDecimals / |netBase|. "0" if no rebalancing */
  netRebalancingAvgPrice: string;

  // --- Totals ---
  totalPremium: string;

  // --- Current balance ---
  currentBase: string;
  currentQuote: string;

  /** Current spot price (quote per 1 base token in raw units) */
  currentSpotPrice: string;

  // --- Token metadata for display ---
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
}

// =============================================================================
// Response Type
// =============================================================================

/**
 * Response type for optionality endpoint
 */
export interface OptionalityResponse extends ApiResponse<OptionalitySummaryData> {
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
