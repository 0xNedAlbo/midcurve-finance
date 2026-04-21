/**
 * Position Accounting API types
 *
 * Per-position balance sheet, realized P&L, and full journal entry audit trail.
 * All amounts are reporting-currency bigint strings (scaled 10^8). Realized-only —
 * no NAV snapshots or mark-to-market values.
 */

export interface PositionBalanceSheet {
  assets: {
    lpPositionAtCost: string;
    totalAssets: string;
  };
  equity: {
    contributedCapital: string;
    capitalReturned: string;
    retainedEarnings: {
      realizedFromWithdrawals: string;
      realizedFromCollectedFees: string;
      realizedFromFxEffect: string;
      total: string;
    };
    totalEquity: string;
  };
}

export interface PositionPnl {
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  realizedFromFxEffect: string;
  netPnl: string;
}

export interface JournalLineData {
  accountCode: number;
  accountName: string;
  accountCategory: string;
  side: 'debit' | 'credit';
  amountReporting: string | null;
}

export interface JournalEntryData {
  id: string;
  entryDate: string;
  description: string;
  memo: string | null;
  lines: JournalLineData[];
}

export interface PositionAccountingResponse {
  positionRef: string;
  reportingCurrency: string;
  balanceSheet: PositionBalanceSheet;
  pnl: PositionPnl;
  journalEntries: JournalEntryData[];
}
