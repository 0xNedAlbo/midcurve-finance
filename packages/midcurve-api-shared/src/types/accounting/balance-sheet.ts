/**
 * Balance Sheet API types
 *
 * Structured balance sheet with period-over-period comparison.
 * Reports realized values only (cost-basis model).
 */

import type { PeriodQuery } from './pnl.js';

export interface BalanceSheetLineItem {
  current: string;
  previous: string | null;
  deltaAbs: string | null;
  deltaPct: string | null;
}

export interface BalanceSheetData {
  period: PeriodQuery;
  currentDate: string;
  previousDate: string | null;
  reportingCurrency: string;

  assets: {
    depositedLiquidityAtCost: BalanceSheetLineItem;
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
      realizedFromFxEffect: BalanceSheetLineItem;
      totalRetainedEarnings: BalanceSheetLineItem;
    };
    totalEquity: BalanceSheetLineItem;
  };

  activePositionCount: number;
}

export type BalanceSheetResponse = BalanceSheetData;
