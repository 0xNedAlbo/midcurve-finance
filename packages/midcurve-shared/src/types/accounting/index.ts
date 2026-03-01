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
  ACCRUED_FEE_INCOME_REVENUE: 4001,
  REALIZED_GAINS: 4100,
  UNREALIZED_GAINS: 4200,
  // Expenses
  REALIZED_LOSSES: 5000,
  GAS_EXPENSE: 5100,
  UNREALIZED_LOSSES: 5200,
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

/**
 * Chart of Accounts — full definition of every account.
 *
 * Single source of truth used by the seed script and worker startup seeding.
 * Each entry maps 1:1 to an AccountDefinition row in the database.
 */
export interface AccountDefinitionSeed {
  code: number;
  name: string;
  description: string;
  category: AccountCategory;
  normalSide: JournalSide;
}

export const CHART_OF_ACCOUNTS: readonly AccountDefinitionSeed[] = [
  // Assets (1xxx)
  {
    code: 1000,
    name: 'LP Position at Cost',
    description:
      'Cost basis of active positions. Debited on open/increase, credited on close/decrease.',
    category: 'asset',
    normalSide: 'debit',
  },
  {
    code: 1001,
    name: 'LP Position Unrealized Adjustment',
    description:
      'Mark-to-market adjustment above/below cost. Net of 1000 + 1001 = fair value.',
    category: 'asset',
    normalSide: 'debit',
  },
  {
    code: 1002,
    name: 'Accrued Fee Income',
    description:
      'Unclaimed fees on active positions. Debited as fees accrue, credited when collected.',
    category: 'asset',
    normalSide: 'debit',
  },
  // Equity (3xxx)
  {
    code: 3000,
    name: 'Contributed Capital',
    description: 'Total capital invested into positions (subscriptions).',
    category: 'equity',
    normalSide: 'credit',
  },
  {
    code: 3100,
    name: 'Capital Returned',
    description: 'Total capital returned from closed positions and collected fees (redemptions).',
    category: 'equity',
    normalSide: 'debit',
  },
  // Revenue (4xxx)
  {
    code: 4000,
    name: 'Fee Income',
    description: 'LP fees collected (realized fee income).',
    category: 'revenue',
    normalSide: 'credit',
  },
  {
    code: 4001,
    name: 'Accrued Fee Income Revenue',
    description: 'Unclaimed fee accruals on active positions (unrealized fee income).',
    category: 'revenue',
    normalSide: 'credit',
  },
  {
    code: 4100,
    name: 'Realized Gains',
    description: 'Gains crystallized upon position decrease or close.',
    category: 'revenue',
    normalSide: 'credit',
  },
  {
    code: 4200,
    name: 'Unrealized Gains',
    description: 'Positive mark-to-market changes on open positions.',
    category: 'revenue',
    normalSide: 'credit',
  },
  // Expenses (5xxx)
  {
    code: 5000,
    name: 'Realized Losses',
    description: 'Losses crystallized upon position decrease or close.',
    category: 'expense',
    normalSide: 'debit',
  },
  {
    code: 5100,
    name: 'Gas Expense',
    description: 'On-chain transaction costs (when data is available).',
    category: 'expense',
    normalSide: 'debit',
  },
  {
    code: 5200,
    name: 'Unrealized Losses',
    description: 'Negative mark-to-market changes on open positions.',
    category: 'expense',
    normalSide: 'debit',
  },
] as const;

/**
 * Prefixes for the `ledgerEventRef` column in journal entries.
 *
 * Because different instrument types have their own ledger tables,
 * the ref is stored as `{prefix}:{id}` to disambiguate the source table.
 */
export const LEDGER_REF_PREFIX = {
  POSITION_LEDGER: 'position_ledger',
} as const;

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
  positionRef?: string;    // position hash — e.g., "uniswapv3/42161/5334690"
  instrumentRef?: string;  // pool hash — e.g., "uniswapv3/42161/0x8ad5..."
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
  positionRef: string;     // position hash
  instrumentRef: string;   // pool hash
  poolSymbol: string;
  currentValueReporting: string;
  costBasisReporting: string;
  unrealizedPnlReporting: string;
  accruedFeesReporting: string;
}
