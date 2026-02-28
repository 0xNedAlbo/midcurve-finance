/**
 * Balance Sheet (NAV Report) API types
 */

export interface BalanceSheetPositionItem {
  instrumentRef: string;
  poolSymbol: string;
  currentValueReporting: string;
  costBasisReporting: string;
  unrealizedPnlReporting: string;
  accruedFeesReporting: string;
}

export interface BalanceSheetResponse {
  snapshotDate: string;
  reportingCurrency: string;
  valuationMethod: string;
  /** Total assets = LP positions (at cost + unrealized adjustment) + accrued fees */
  totalAssets: string;
  /** Total liabilities (always "0" in Phase 1) */
  totalLiabilities: string;
  /** NAV = totalAssets - totalLiabilities */
  netAssetValue: string;
  equity: {
    contributedCapital: string;
    capitalReturned: string;
    accumulatedPnl: string;
  };
  positions: BalanceSheetPositionItem[];
  activePositionCount: number;
}
