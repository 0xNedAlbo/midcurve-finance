/**
 * Double-Entry Accounting Types — Phase 1
 *
 * Types for the journal system, chart of accounts, and NAV snapshots.
 */

// =============================================================================
// Account Classification
// =============================================================================

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type JournalSide = 'debit' | 'credit';

/**
 * Phase 1 account codes. Values match the seeded AccountDefinition rows.
 */
export const ACCOUNT_CODES = {
  // Assets
  LP_POSITION_AT_COST: 1000,
  LP_POSITION_UNREALIZED_ADJUSTMENT: 1001,
  ACCRUED_FEE_INCOME: 1002,
  // Equity
  CONTRIBUTED_CAPITAL: 3000,
  CAPITAL_RETURNED: 3100,
  // Revenue
  FEE_INCOME: 4000,
  REALIZED_GAINS: 4100,
  UNREALIZED_GAINS: 4200,
  // Expenses
  REALIZED_LOSSES: 5000,
  GAS_EXPENSE: 5100,
  UNREALIZED_LOSSES: 5200,
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

// =============================================================================
// Journal Entry / Line Input Types (for service layer)
// =============================================================================

export interface JournalEntryInput {
  userId: string;
  domainEventId?: string;
  domainEventType?: string;
  ledgerEventRef?: string;
  entryDate: Date;
  description: string;
  memo?: string;
}

export interface JournalLineInput {
  accountCode: number;
  instrumentRef?: string;
  side: JournalSide;
  amountQuote: string; // bigint as string
  amountReporting?: string;
  reportingCurrency?: string;
  exchangeRate?: string;
}

// =============================================================================
// NAV Snapshot Types
// =============================================================================

export type SnapshotType = 'daily' | 'manual';

export type ValuationMethod = 'pool_price';

export interface PositionBreakdownItem {
  instrumentRef: string;
  poolSymbol: string;
  currentValueReporting: string;
  costBasisReporting: string;
  unrealizedPnlReporting: string;
  accruedFeesReporting: string;
}
