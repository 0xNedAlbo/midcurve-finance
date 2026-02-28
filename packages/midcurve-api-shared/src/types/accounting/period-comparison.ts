/**
 * Period Comparison API types
 */

import type { PeriodQuery } from './pnl.js';

export interface SnapshotSummary {
  snapshotDate: string;
  netAssetValue: string;
  totalAssets: string;
  totalLiabilities: string;
  activePositionCount: number;
}

export interface PeriodDelta {
  netAssetValue: string;
  netAssetValuePct: string;
  feeIncome: string;
  realizedPnl: string;
  unrealizedPnl: string;
}

export interface PeriodComparisonResponse {
  period: PeriodQuery;
  reportingCurrency: string;
  current: SnapshotSummary;
  previous: SnapshotSummary | null;
  delta: PeriodDelta | null;
}
