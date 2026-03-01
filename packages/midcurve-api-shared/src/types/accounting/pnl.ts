/**
 * P&L Statement API types
 *
 * Hierarchical P&L: Portfolio → Instrument → Position with 4 sub-categories.
 */

import { z } from 'zod';

export const PeriodQuerySchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type PeriodQuery = z.infer<typeof PeriodQuerySchema>;

export const OffsetQuerySchema = z.coerce.number().int().max(0).default(0);

export interface PnlPositionItem {
  positionRef: string;
  nftId: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
}

export interface PnlInstrumentItem {
  instrumentRef: string;
  poolSymbol: string;
  protocol: string;
  chainId: number;
  feeTier: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
  positions: PnlPositionItem[];
}

export interface PnlResponse {
  period: PeriodQuery;
  startDate: string;
  endDate: string;
  reportingCurrency: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
  instruments: PnlInstrumentItem[];
}
