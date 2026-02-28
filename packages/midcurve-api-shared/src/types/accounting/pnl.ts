/**
 * P&L Breakdown API types
 */

import { z } from 'zod';

export const PeriodQuerySchema = z.enum(['day', 'week', 'month', 'quarter', 'year']);
export type PeriodQuery = z.infer<typeof PeriodQuerySchema>;

export interface PnlInstrumentItem {
  instrumentRef: string;
  poolSymbol: string;
  protocol: string;
  chainId: number;
  feeTier: string;
  feeIncome: string;
  realizedPnl: string;
  unrealizedPnl: string;
}

export interface PnlResponse {
  period: PeriodQuery;
  startDate: string;
  endDate: string;
  reportingCurrency: string;
  /** Account 4000 net */
  feeIncome: string;
  /** Accounts 4100 - 5000 net */
  realizedPnl: string;
  /** Accounts 4200 - 5200 net */
  unrealizedPnl: string;
  /** Account 5100 */
  gasExpense: string;
  /** feeIncome + realizedPnl + unrealizedPnl - gasExpense */
  netPnl: string;
  instruments: PnlInstrumentItem[];
}
