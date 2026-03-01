/**
 * Balance Sheet API types
 *
 * Structured balance sheet with period-over-period comparison.
 */

import type { PeriodQuery } from './pnl.js';

export interface BalanceSheetLineItem {
  current: string;
  previous: string | null;
  deltaAbs: string | null;
  deltaPct: string | null;
}

export interface BalanceSheetResponse {
  period: PeriodQuery;
  currentDate: string;
  previousDate: string | null;
  reportingCurrency: string;

  assets: {
    depositedLiquidityAtCost: BalanceSheetLineItem;
    markToMarketAdjustment: BalanceSheetLineItem;
    unclaimedFees: BalanceSheetLineItem;
    totalAssets: BalanceSheetLineItem;
  };

  liabilities: {
    totalLiabilities: BalanceSheetLineItem;
  };

  equity: {
    contributedCapital: BalanceSheetLineItem;
    capitalReturned: BalanceSheetLineItem;
    retainedEarnings: {
      realizedFromWithdrawals: BalanceSheetLineItem;
      realizedFromCollectedFees: BalanceSheetLineItem;
      unrealizedFromPriceChanges: BalanceSheetLineItem;
      unrealizedFromUnclaimedFees: BalanceSheetLineItem;
      totalRetainedEarnings: BalanceSheetLineItem;
    };
    totalEquity: BalanceSheetLineItem;
  };

  activePositionCount: number;
}
