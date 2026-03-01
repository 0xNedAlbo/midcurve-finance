# Portfolio Balance Sheet & P&L Statement
## Product Requirements Document · Midcurve Finance

**Version 1.0 | March 2026**
**Status: DRAFT | Classification: Internal**
**Depends on: [Double-Entry Accounting Phase 1](double-entry-accounting-phase1.md)**

---

## 1. Overview & Goals

### 1.1 Problem Statement

The current Summary tab displays five metric cards (NAV, Net P&L, Fee Income, Realized P&L, Unrealized P&L), a 90-day NAV area chart, and a flat per-position P&L table. This view has several shortcomings:

1. **No structured Balance Sheet.** There is no formal asset/liability/equity breakdown. Total assets appear as a single number without decomposition.
2. **No period-over-period comparison on the Balance Sheet.** The user cannot see how each line item changed relative to the previous period.
3. **P&L lacks sub-category granularity.** Realized P&L does not distinguish between gains from withdrawals and income from collected fees. Unrealized P&L does not distinguish between price-driven changes and unclaimed fee accrual.
4. **No instrument-level grouping.** The P&L table lists individual positions (NFT IDs) flat. Users with multiple positions in the same pool cannot see aggregate pool-level performance.
5. **Rolling periods, not calendar-based.** "Month" means "last 30 days," not "since the 1st of the month." This makes period boundaries unpredictable and inconsistent with standard financial reporting.

### 1.2 Solution

Replace the Summary tab with two views:

1. **Balance Sheet** — A snapshot of the portfolio's financial position, displayed as a comparison table (current period vs. previous period with deltas).
2. **P&L Statement** — A hierarchical, expandable breakdown of gains and losses within the selected period, drillable from portfolio total → instrument (pool) → individual position (NFT ID).

Both views share a single period selector using UTC calendar-based boundaries.

### 1.3 Design Principles

- **Position-scoped boundary.** Consistent with Phase 1: the system tracks LP positions only, not wallet-level token holdings. Assets on the Balance Sheet reflect only what is inside active positions.
- **Calendar periods.** All period boundaries align to UTC calendar dates (Monday for weeks, 1st for months, etc.) — never rolling windows.
- **Accounting-derived.** All values are sourced from the double-entry journal system, not from raw position fields. This ensures consistency with the Chart of Accounts.
- **Instrument-agnostic naming.** The grouping level between portfolio and position is called "instrument," not "pool." This allows future extension to non-pool instruments (Aave lending markets, perpetual vaults, etc.).

### 1.4 Non-Goals

- Wallet-level token tracking (e.g., "collected fees sitting in the user's wallet").
- Custom date ranges (only predefined calendar periods in v1).
- CSV/PDF export (deferred).
- Base currency toggle in the UI (user sets reporting currency in settings; no in-view toggle).

---

## 2. Prerequisite: Journal Schema Refactor

Before implementing the Balance Sheet and P&L views, the journal data model requires a refactor to support instrument-level (pool-level) aggregation natively.

### 2.1 Problem

The `JournalLine.instrumentRef` field currently stores the **position hash** (e.g., `"uniswapv3/42161/5334690"`). To aggregate P&L at the instrument (pool) level, the current P&L endpoint must JOIN through `Position` → `Pool` at read time. This is both slow and architecturally wrong — the field name "instrumentRef" implies it references an instrument, but it actually references a position.

### 2.2 New Account: 4001 `ACCRUED_FEE_INCOME_REVENUE`

Account 4000 (`FEE_INCOME`) currently handles both collected and accrued (unclaimed) fee income. To enable clean P&L aggregation by account code alone (no `domainEventType` filtering), split into:

| Code | Name | Category | Normal Side | Usage |
|------|------|----------|-------------|-------|
| 4000 | `FEE_INCOME` | Revenue | Credit | Collected fees only (realized) |
| 4001 | `ACCRUED_FEE_INCOME_REVENUE` | Revenue | Credit | Unclaimed fee accruals (unrealized) |

**Journal entry changes:**
- Fee accrual on `position.state.refreshed`: `DR 1002 / CR 4001` (was `DR 1002 / CR 4000`)
- Fee accrual during backfill: `DR 1002 / CR 4001` (was `DR 1002 / CR 4000`)
- Fee collection on `position.fees.collected`: `DR 3100 / CR 4000` — unchanged

**Data migration:** UPDATE existing journal lines where `accountId` maps to code 4000 AND the parent `JournalEntry.domainEventType` indicates a fee-accrual event → set account to the new 4001 account.

**Affected files:**
- `packages/midcurve-shared/src/types/accounting/index.ts` — add `ACCRUED_FEE_INCOME_REVENUE: 4001` to `ACCOUNT_CODES`
- `packages/midcurve-database/prisma/seed-accounts.ts` — add seed row for account 4001
- `apps/midcurve-business-logic/.../post-journal-entries-on-position-events.ts:477` — change `FEE_INCOME` to `ACCRUED_FEE_INCOME_REVENUE`
- `packages/midcurve-services/.../journal-backfill-service.ts:218` — change `FEE_INCOME` to `ACCRUED_FEE_INCOME_REVENUE`

This makes P&L aggregation a pure `GROUP BY accountCode` — each of the 4 P&L categories maps to distinct account codes with no JOIN to journal entries needed:

| P&L Category | Accounts |
|---|---|
| Realized: From Withdrawals | 4100 (`REALIZED_GAINS`) - 5000 (`REALIZED_LOSSES`) |
| Realized: From Collected Fees | 4000 (`FEE_INCOME`) |
| Unrealized: From Price Changes | 4200 (`UNREALIZED_GAINS`) - 5200 (`UNREALIZED_LOSSES`) |
| Unrealized: From Unclaimed Fees | 4001 (`ACCRUED_FEE_INCOME_REVENUE`) |

### 2.3 Changes

#### 2.3.1 Rename `instrumentRef` → `positionRef` on `JournalLine`

The existing field is renamed to accurately describe what it stores: a soft reference to a position.

```
Before:  instrumentRef  String?  // "uniswapv3/42161/5334690"
After:   positionRef    String?  // "uniswapv3/42161/5334690" (same data, correct name)
```

Update all indexes accordingly:
- `@@index([positionRef])` (was `@@index([instrumentRef])`)
- `@@index([accountId, positionRef])` (was `@@index([accountId, instrumentRef])`)

#### 2.3.2 Add `instrumentRef` on `JournalLine`

A new field that stores the **instrument hash** — currently the pool hash (e.g., `"uniswapv3/42161/0x8ad5..."`), but designed to reference any instrument type in the future (Aave lending market, perpetual vault, etc.).

```prisma
instrumentRef  String?  // "uniswapv3/42161/0x8ad5..." (pool hash, denormalized)
```

New indexes:
- `@@index([instrumentRef])`
- `@@index([accountId, instrumentRef])`

**Populated at write time:** When creating journal entries, look up `pool.poolHash` via `position.poolId` and store it as `instrumentRef`. This is a one-time denormalization per entry, enabling fast GROUP BY queries at read time without JOINs.

#### 2.3.3 Rename `TrackedInstrument` → `TrackedPosition`

The `TrackedInstrument` model tracks individual positions, not instruments. Rename for clarity:

```
Before:
  model TrackedInstrument {
    instrumentRef  String
    @@unique([userId, instrumentRef])
    @@map("tracked_instruments")
  }

After:
  model TrackedPosition {
    positionRef  String
    @@unique([userId, positionRef])
    @@map("tracked_positions")
  }
```

#### 2.3.4 Shared Type Updates

| Type | Field Change |
|------|-------------|
| `JournalLineInput` (`@midcurve/shared`) | `instrumentRef?` → `positionRef?` + add `instrumentRef?` |
| `PositionBreakdownItem` (`@midcurve/shared`) | `instrumentRef` → `positionRef` + add `instrumentRef` |
| `PnlInstrumentItem` (`@midcurve/api-shared`) | Restructured in Section 6 |
| `BalanceSheetPositionItem` (`@midcurve/api-shared`) | `instrumentRef` → `positionRef` |

#### 2.3.5 Service Method Updates

All methods in `JournalService` that accept or query by `instrumentRef` must be updated:
- Methods operating on positions: rename parameter to `positionRef` (e.g., `getAccountBalance`, `deleteByInstrumentRef` → `deleteByPositionRef`)
- Add new methods for instrument-level queries where needed (e.g., `getAccountBalanceByInstrument`)

The `JournalLineBuilder.debit()` and `.credit()` methods gain a second optional parameter:
```typescript
debit(accountCode: number, amountQuote: string, positionRef?: string, instrumentRef?: string): this
credit(accountCode: number, amountQuote: string, positionRef?: string, instrumentRef?: string): this
```

#### 2.3.6 Business Logic Updates

All event handlers in `post-journal-entries-on-position-events.ts` currently do:
```typescript
const instrumentRef = position.positionHash;
```

This changes to:
```typescript
const positionRef = position.positionHash;
const instrumentRef = position.pool.poolHash; // denormalized from pool relation
```

The pool hash is available because the event handlers already load the position with pool relations.

#### 2.3.7 Backfill Migration

Existing `JournalLine` rows need their `instrumentRef` (now `positionRef`) data preserved, and the new `instrumentRef` column populated. A data migration:

1. Rename column `instrumentRef` → `positionRef`
2. Add column `instrumentRef` (nullable)
3. UPDATE `journal_lines` SET `instrumentRef` = (SELECT `poolHash` FROM pools JOIN positions ON positions."poolId" = pools.id WHERE positions."positionHash" = journal_lines."positionRef")

---

## 3. Period Definitions

### 3.1 Available Periods

| Period  | Label     | Default |
|---------|-----------|---------|
| Day     | Daily     |         |
| Week    | Weekly    | ✓       |
| Month   | Monthly   |         |
| Quarter | Quarterly |         |
| Year    | Annual    |         |

### 3.2 Calendar-Based Boundaries (UTC)

All boundaries are defined in UTC. "Current period" runs from the period start to `now`. "Previous period" is the immediately preceding complete calendar period.

| Period  | Current Start                              | Previous Start → End                                |
|---------|--------------------------------------------|-----------------------------------------------------|
| Day     | 00:00 UTC today                            | 00:00 UTC yesterday → 00:00 UTC today               |
| Week    | 00:00 UTC, Monday of current week          | 00:00 UTC, Monday of prior week → Monday this week   |
| Month   | 00:00 UTC, 1st of current month            | 00:00 UTC, 1st of prior month → 1st of this month    |
| Quarter | 00:00 UTC, 1st of current quarter          | 00:00 UTC, 1st of prior quarter → 1st of this quarter|
| Year    | 00:00 UTC, January 1st of current year     | 00:00 UTC, Jan 1 prior year → Jan 1 this year        |

Quarter starts: January 1, April 1, July 1, October 1.

### 3.3 Implementation

A shared utility function replaces the existing rolling `getPeriodDateRange()` and `subtractPeriod()`:

```typescript
function getCalendarPeriodBoundaries(period: PeriodQuery, now?: Date): {
  currentStart: Date;
  currentEnd: Date;     // = now
  previousStart: Date;
  previousEnd: Date;    // = currentStart
}
```

This utility lives in `@midcurve/shared` (pure function, no dependencies) and is used by:
- `apps/midcurve-api/.../accounting/pnl/route.ts` (replaces `getPeriodDateRange()`)
- `packages/midcurve-services/.../nav-snapshot-service.ts` (replaces `subtractPeriod()`)
- `apps/midcurve-api/.../accounting/balance-sheet/route.ts` (new period support)

---

## 4. Balance Sheet

### 4.1 Structure

The Balance Sheet displays the portfolio's financial position at the end of the selected period (or `now` for the current period), following:

```
Total Assets = Total Liabilities + Total Equity
```

### 4.2 Assets

| Line Item | Source | Description |
|-----------|--------|-------------|
| Deposited Liquidity at Cost | Account 1000 (`LP_POSITION_AT_COST`) | Historical cost basis of all active positions |
| Mark-to-Market Adjustment | Account 1001 (`LP_POSITION_UNREALIZED_ADJUSTMENT`) | Unrealized gain/loss from price movements |
| Unclaimed Fees | Account 1002 (`ACCRUED_FEE_INCOME`) | Accrued fees not yet collected |
| **Total Assets** | Sum of above | |

**Note:** "Deposited Liquidity (MtM)" from the original proposal is the sum of accounts 1000 + 1001. These are shown as two separate line items for transparency, but may be visually grouped with a subtotal.

### 4.3 Liabilities

| Line Item | Value | Note |
|-----------|-------|------|
| **Total Liabilities** | $0.00 | No obligations modeled in Phase 1 |

### 4.4 Equity

| Line Item | Source | Description |
|-----------|--------|-------------|
| Contributed Capital | Account 3000 (`CONTRIBUTED_CAPITAL`) | Cumulative deposits at historical cost |
| Capital Returned | Account 3100 (`CAPITAL_RETURNED`) | Cumulative withdrawals + fee collections |
| **Retained Earnings** | Sum of 4 sub-categories below | |
| — Realized: From Withdrawals | Accounts 4100 - 5000 (`REALIZED_GAINS` - `REALIZED_LOSSES`) | Withdrawal value minus proportional cost basis |
| — Realized: From Collected Fees | Account 4000 (`FEE_INCOME`) | Fees that have been claimed |
| — Unrealized: From Price Changes | Accounts 4200 - 5200 (`UNREALIZED_GAINS` - `UNREALIZED_LOSSES`) | M2M valuation change vs. cost basis |
| — Unrealized: From Unclaimed Fees | Account 4001 (`ACCRUED_FEE_INCOME_REVENUE`) | Accrued fees not yet collected |
| **Total Equity** | Contributed Capital - Capital Returned + Retained Earnings | |

### 4.5 Period Comparison Layout

The Balance Sheet is displayed as a four-column table:

```
                                Current     Previous      Δ Abs.      Δ %
─────────────────────────────────────────────────────────────────────────────
Assets
  Deposited Liquidity at Cost      xxx         xxx          xxx        xx%
  Mark-to-Market Adjustment        xxx         xxx          xxx        xx%
  Unclaimed Fees                   xxx         xxx          xxx        xx%
Total Assets                       xxx         xxx          xxx        xx%

Liabilities
Total Liabilities                   —           —            —          —

Equity
  Contributed Capital              xxx         xxx          xxx        xx%
  Capital Returned                 xxx         xxx          xxx        xx%
  Retained Earnings
    Realized: Withdrawals          xxx         xxx          xxx        xx%
    Realized: Collected Fees       xxx         xxx          xxx        xx%
    Unrealized: Price Changes      xxx         xxx          xxx        xx%
    Unrealized: Unclaimed Fees     xxx         xxx          xxx        xx%
  Total Retained Earnings          xxx         xxx          xxx        xx%
Total Equity                       xxx         xxx          xxx        xx%
─────────────────────────────────────────────────────────────────────────────
Total Liabilities + Equity         xxx         xxx          xxx        xx%
```

- **Current** = snapshot at `now` (or end of selected period)
- **Previous** = snapshot at end of previous calendar period
- **Δ Abs.** = Current - Previous
- **Δ %** = (Current - Previous) / |Previous| × 100

### 4.6 Display Conventions

- Negative values displayed in red: `- 1,234.56`
- All values in the user's reporting currency (from `user.reportingCurrency`)
- Format using `formatReportingAmount()` from existing format utilities
- Delta percentage: `—` when previous value is zero (avoid division by zero)

---

## 5. P&L Statement

### 5.1 Overview

The P&L Statement shows the change in Retained Earnings within the selected period:

```
Retained Earnings (End of Previous Period)
  + Net P&L (Current Period)
  = Retained Earnings (End of Current Period)
```

### 5.2 Hierarchy

Three-level expandable drilldown:

```
Level 0: Portfolio Total (Net P&L)
  └── Level 1: Instrument (pool / lending market / etc.)
        └── Level 2: Individual Position (NFT ID)
```

### 5.3 Instrument Identifier (Level 1)

Each instrument is identified by:

```
[Chain] · [Protocol] · [Token Pair] · [Fee Tier]
```

Example: `Arbitrum · Uniswap V3 · WETH/USDC · 0.05%`

The grouping key is `JournalLine.instrumentRef` (the new pool-hash field). Pool metadata (chain, protocol, token pair, fee tier) is looked up from the `Pool` model at API response time.

### 5.4 Position Identifier (Level 2)

Each position is identified by its NFT token ID:

Example: `NFT ID #4784746`

The grouping key is `JournalLine.positionRef` (the renamed field).

### 5.5 P&L Categories (Applied at Every Level)

| Category | Type | Account Codes | Description |
|----------|------|---------------|-------------|
| From Withdrawals | Realized | 4100 (`REALIZED_GAINS`) - 5000 (`REALIZED_LOSSES`) | Withdrawal value minus proportional cost basis |
| From Collected Fees | Realized | 4000 (`FEE_INCOME`) | Fees claimed from positions |
| From Price Changes | Unrealized | 4200 (`UNREALIZED_GAINS`) - 5200 (`UNREALIZED_LOSSES`) | M2M valuation change vs. cost basis |
| From Unclaimed Fees | Unrealized | 4001 (`ACCRUED_FEE_INCOME_REVENUE`) | Change in accrued but unclaimed fees |

Each category maps to distinct account codes — no `domainEventType` filtering needed.

**Note on gas expense:** Account 5100 (`GAS_EXPENSE`) exists in the chart of accounts but no journal entries are posted to it (gas tracking is not yet implemented). When gas tracking is added in a future phase, it would appear as a fifth P&L category under "Realized" expenses. Until then, it is excluded from the P&L breakdown.

### 5.6 Layout Example

```
P&L Statement — Weekly, March 3–9, 2026

▼ Arbitrum · Uniswap V3 · WETH/USDC · 0.05%                    Σ +$1,234.56
│
│   Realized Gains / (Losses)
│   ├── From Withdrawals                                            +$800.00
│   └── From Collected Fees                                         +$200.00
│   Unrealized Gains / (Losses)
│   ├── From Price Changes                                          +$150.00
│   └── From Unclaimed Fees                                          +$84.56
│
├── ▼ NFT ID #4784746                                           Σ +$734.56
│       Realized Gains / (Losses)
│       ├── From Withdrawals                                        +$500.00
│       └── From Collected Fees                                     +$120.00
│       Unrealized Gains / (Losses)
│       ├── From Price Changes                                       +$80.00
│       └── From Unclaimed Fees                                      +$34.56
│
└── ▶ NFT ID #4791002                                           Σ +$500.00

▶ Arbitrum · Uniswap V3 · ARB/USDC · 0.30%                    Σ −($456.78)

──────────────────────────────────────────────────────────────────────────────
Net P&L (Period)                                                  Σ +$777.78
  Realized Total                                                 Σ +$1,500.00
  Unrealized Total                                                Σ −($722.22)
```

### 5.7 Aggregation Rules

- **Level 2 (Position):** Raw journal line aggregations per `positionRef` within the period.
- **Level 1 (Instrument):** Sum of all Level 2 positions sharing the same `instrumentRef`.
- **Level 0 (Portfolio):** Sum of all Level 1 instruments.
- Each level independently shows the four-category breakdown.

---

## 6. API Changes

### 6.1 P&L Endpoint — Restructured

**`GET /api/v1/accounting/pnl?period=week`**

The response is restructured from a flat per-position list to a hierarchical instrument → position format with 4 P&L sub-categories.

```typescript
// New response types (replace current PnlInstrumentItem)

interface PnlPositionItem {
  positionRef: string;           // "uniswapv3/42161/5334690"
  nftId: string;                 // "5334690"
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
}

interface PnlInstrumentItem {
  instrumentRef: string;         // "uniswapv3/42161/0x8ad5..." (pool hash)
  poolSymbol: string;            // "WETH/USDC"
  protocol: string;              // "uniswapv3"
  chainId: number;               // 42161
  feeTier: string;               // "500"
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
  positions: PnlPositionItem[];
}

interface PnlResponse {
  period: PeriodQuery;
  startDate: string;             // ISO 8601
  endDate: string;               // ISO 8601
  reportingCurrency: string;
  realizedFromWithdrawals: string;
  realizedFromCollectedFees: string;
  unrealizedFromPriceChanges: string;
  unrealizedFromUnclaimedFees: string;
  netPnl: string;
  instruments: PnlInstrumentItem[];
}
```

**Query changes:**
- Use `getCalendarPeriodBoundaries()` instead of rolling `getPeriodDateRange()`
- Group first by `instrumentRef` (pool hash), then by `positionRef` within each instrument
- Aggregate into 4 buckets by account code alone (no `domainEventType` filtering needed):
  - Realized from Withdrawals: net of accounts 4100 - 5000
  - Realized from Collected Fees: account 4000
  - Unrealized from Price Changes: net of accounts 4200 - 5200
  - Unrealized from Unclaimed Fees: account 4001

### 6.2 Balance Sheet Endpoint — Enhanced

**`GET /api/v1/accounting/balance-sheet?period=week`**

Add `period` query parameter (default: `week`). Returns current and previous period values for each line item.

```typescript
interface BalanceSheetLineItem {
  current: string;               // bigint as string (10^8 scale)
  previous: string | null;       // null if no previous snapshot
  deltaAbs: string | null;       // current - previous
  deltaPct: string | null;       // basis points (10^4 scale)
}

interface BalanceSheetResponse {
  period: PeriodQuery;
  currentDate: string;           // ISO 8601
  previousDate: string | null;   // ISO 8601
  reportingCurrency: string;

  assets: {
    depositedLiquidityAtCost: BalanceSheetLineItem;  // account 1000
    markToMarketAdjustment: BalanceSheetLineItem;    // account 1001
    unclaimedFees: BalanceSheetLineItem;             // account 1002
    totalAssets: BalanceSheetLineItem;
  };

  liabilities: {
    totalLiabilities: BalanceSheetLineItem;          // always "0"
  };

  equity: {
    contributedCapital: BalanceSheetLineItem;        // account 3000
    capitalReturned: BalanceSheetLineItem;            // account 3100
    retainedEarnings: {
      realizedFromWithdrawals: BalanceSheetLineItem;  // accounts 4100 - 5000
      realizedFromCollectedFees: BalanceSheetLineItem; // account 4000
      unrealizedFromPriceChanges: BalanceSheetLineItem; // accounts 4200 - 5200
      unrealizedFromUnclaimedFees: BalanceSheetLineItem; // account 4001
      totalRetainedEarnings: BalanceSheetLineItem;
    };
    totalEquity: BalanceSheetLineItem;
  };

  activePositionCount: number;
}
```

**Data sources — current vs. previous:**

The two columns have different data sources:

- **Previous column:** Read from the extended NAV snapshot (see Section 8) closest to the previous period boundary. Snapshots are generated daily at midnight UTC and contain all line-item values pre-computed.

- **Current column:** Computed on-demand at request time, combining two sources:

  | Line Item | Source | Freshness |
  |-----------|--------|-----------|
  | Deposited Liquidity at Cost (1000) | Journal account balance | Always current (event-driven) |
  | Mark-to-Market Adjustment (1001) | Live: `Σ position.currentValue` (converted to reporting currency) minus account 1000 balance | As fresh as last position refresh (≤60s with polling) |
  | Unclaimed Fees (1002) | Live: `Σ position.unClaimedFees` (converted to reporting currency) | As fresh as last position refresh |
  | Contributed Capital (3000) | Journal account balance | Always current (event-driven) |
  | Capital Returned (3100) | Journal account balance | Always current (event-driven) |
  | Realized: Withdrawals (4100-5000) | Journal account balances | Always current (event-driven) |
  | Realized: Collected Fees (4000) | Journal account balance | Always current (event-driven) |
  | Unrealized: Price Changes | Derived: live M2M total minus journal 4200-5200 is not needed — use journal balances from last M2M run, difference is captured in M2M adjustment line above | Journal balance from last daily cron |
  | Unrealized: Unclaimed Fees (4001) | Derived: mirrors the live unclaimed fees asset line | Computed from live position data |

  The live position values (`currentValue`, `unClaimedFees`) are refreshed by the frontend's 60-second polling loop while on the Positions tab. The balance sheet endpoint reads these from the `Position` model and converts to reporting currency using cached CoinGecko rates.

  **Simplification:** Since the unrealized journal balances (4200/5200 and 4001) are only updated at the daily cron, the current column can also just use position-level fields directly for the unrealized section:
  - Total Assets = `Σ position.currentValue + Σ position.unClaimedFees` (in reporting currency)
  - Total Equity unrealized = Total Assets - (account 1000 balance) - (account 1002 from last cron)... this gets complex.

  **Recommended approach:** Compute the current Balance Sheet as a **virtual snapshot** using the same logic as the daily cron (`daily-nav-snapshot.ts`), but reading from already-refreshed position data instead of triggering on-chain reads. This reuses the existing snapshot computation code and ensures Assets = Liabilities + Equity by construction. The only difference vs. the daily cron is that it skips the on-chain refresh step (positions are already fresh from the 60s polling) and does not persist the snapshot to the database.

- **Deltas:** Computed as `current - previous` for absolute, `(current - previous) / |previous| × 100` for percentage.

### 6.3 Deprecated Endpoints

| Endpoint | Disposition |
|----------|-------------|
| `GET /accounting/period-comparison` | Deprecated. Balance sheet endpoint now includes comparison columns. |
| `GET /accounting/nav-timeline` | Deprecated. NAV chart removed from UI. Endpoint remains available but is no longer called by the frontend. |

### 6.4 Tracked Instruments Endpoint — Renamed

**`POST /api/v1/accounting/tracked-positions`** (was `tracked-instruments`)

```typescript
// Request (unchanged semantics)
interface ToggleTrackingRequest {
  positionHash: string;
}

// Response
interface ToggleTrackingResponse {
  tracked: boolean;
}
```

### 6.5 Bulk Position Refresh Endpoint — New

**`POST /api/v1/positions/refresh-all`**

Refreshes all of the authenticated user's active positions from on-chain data in a single call. This is the backend for the UI refresh button on the Balance Sheet / P&L views.

**Rate limiting:** Before refreshing, the endpoint checks `MIN(updatedAt)` across all of the user's active positions. If the oldest `updatedAt` is less than 60 seconds ago, the refresh is skipped and a 429 response is returned with a `retryAfter` value indicating how many seconds to wait.

The 60-second threshold is hardcoded for now. In a later stage, this will be coupled to the user's paid plan tier (e.g., 15s for premium, 60s for free). This is out of scope for this PRD.

```typescript
// Success response (200)
interface RefreshAllResponse {
  refreshedCount: number;        // number of positions refreshed
  oldestUpdatedAt: string;       // ISO 8601 timestamp of the oldest position's updatedAt after refresh
}

// Rate-limited response (429)
interface RefreshAllRateLimitedResponse {
  skipped: true;
  retryAfter: number;            // seconds until next refresh is allowed
  oldestUpdatedAt: string;       // ISO 8601 timestamp of the oldest position's updatedAt
}
```

**Implementation:** Uses the existing `getUniswapV3PositionService().refresh()` for each position — the same service method used by the per-position `POST /positions/uniswapv3/:chainId/:nftId/refresh` endpoint. Positions are refreshed concurrently, grouped by chain for RPC batching efficiency (same pattern as `daily-nav-snapshot.ts` Phase A).

**Authentication:** Session required.

---

## 7. UI Specification

### 7.1 Tab Structure

The Summary tab is replaced by two sub-tabs within the same dashboard page:

```
[Balance Sheet] [P&L Statement]
```

Period selector appears in the header area, shared between both tabs.

### 7.2 Period Selector & Refresh

- Segmented control: `Day | Week | Month | Quarter | Year`
- Default: `Week`
- Period selection persists when switching between Balance Sheet and P&L tabs
- Below the selector, display the date range: e.g., "Mar 3, 2026 — Mar 9, 2026"
- **Refresh button** next to the period selector. On click: calls `POST /api/v1/positions/refresh-all` (see Section 6.5), then refetches balance sheet and P&L data. Shows a loading indicator while refreshing. If the endpoint returns 429 (rate-limited), the button is disabled for the `retryAfter` duration with a countdown or "recently refreshed" label.

### 7.3 Balance Sheet View

Static table layout. All line items visible at once (no expansion). Four columns per the layout in Section 4.5.

**Components to create:**
- `BalanceSheetTable` — Renders the full balance sheet table
- `BalanceSheetLineItemRow` — Single row with 4 value columns

**Components to remove:**
- `AccountingSummaryCards` — Replaced by balance sheet table
- `NavChart` — Removed entirely

### 7.4 P&L View

Expandable table with three levels.

**Default state:**
- All Level 1 instruments collapsed, showing only instrument name + net P&L total
- Click on Level 1 row → expands to show 4-category breakdown + Level 2 position rows
- Click on Level 2 row → expands to show that position's 4-category breakdown

**Components to create:**
- `PnlStatement` — Container with expandable instrument/position rows
- `PnlInstrumentRow` — Level 1 row (collapsible)
- `PnlPositionRow` — Level 2 row (collapsible)
- `PnlCategoryBreakdown` — Reusable 4-category breakdown (used at both levels)

**Components to remove:**
- `PnlPositionTable` — Replaced by hierarchical `PnlStatement`

### 7.5 Mobile Layout

- Balance Sheet: Vertical card layout, one line item per card with current/previous/delta values stacked
- P&L: Same expand/collapse behavior; category breakdown renders as stacked key-value pairs within cards

---

## 8. Data Model Changes

### 8.1 NAV Snapshot Schema Extension

The `NAVSnapshot` model is extended with per-line-item fields for fast balance sheet reads. This avoids on-demand journal aggregation queries.

**New columns on `NAVSnapshot`:**

```prisma
// Asset breakdown (all bigint as String, 10^8 scale)
depositedLiquidityAtCost     String   // account 1000 cumulative balance
markToMarketAdjustment       String   // account 1001 cumulative balance
unclaimedFees                String   // account 1002 cumulative balance

// Equity breakdown
contributedCapital           String   // account 3000 cumulative balance
capitalReturned              String   // account 3100 cumulative balance

// Retained earnings sub-categories
retainedRealizedWithdrawals  String   // accounts 4100 - 5000 net
retainedRealizedFees         String   // account 4000 balance
retainedUnrealizedPrice      String   // accounts 4200 - 5200 net
retainedUnrealizedFees       String   // account 4001 balance
```

**Note:** The existing `totalContributedCapital`, `totalCapitalReturned`, `totalAccumulatedPnl` columns are replaced by the more granular fields above. The existing `periodFeeIncome`, `periodRealizedPnl`, `periodUnrealizedPnl`, `periodGasExpense` columns can be removed (period P&L is now computed from journal lines, not snapshot deltas).

### 8.2 Daily Snapshot Builder Update

The daily NAV snapshot rule (`daily-nav-snapshot.ts`) must compute and store all new fields. The values come from the same journal account balance queries already used for `totalContributedCapital` etc., just stored more granularly.

Each retained earnings sub-category maps directly to an account code query — no derivation needed:
- `retainedRealizedWithdrawals` = balance of 4100 - balance of 5000
- `retainedRealizedFees` = balance of 4000
- `retainedUnrealizedPrice` = balance of 4200 - balance of 5200
- `retainedUnrealizedFees` = balance of 4001

---

## 9. Implementation Work Items

### Phase A: Schema Refactor (Prerequisite)

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| A0 | Add account 4001 `ACCRUED_FEE_INCOME_REVENUE`: seed row, `ACCOUNT_CODES` constant, update fee accrual entries in event handlers + backfill service, data migration for existing 4000 accrual lines | Small | `seed-accounts.ts`, `accounting/index.ts`, `post-journal-entries-on-position-events.ts`, `journal-backfill-service.ts` |
| A1 | Prisma migration: rename `instrumentRef` → `positionRef` on `JournalLine`, add new `instrumentRef` column | Small | `schema.prisma`, new migration SQL |
| A2 | Prisma migration: rename `TrackedInstrument` → `TrackedPosition`, rename `instrumentRef` → `positionRef` | Small | `schema.prisma`, new migration SQL |
| A3 | Data migration: populate `instrumentRef` on existing journal lines from pool hash | Small | Migration SQL with UPDATE + JOIN |
| A4 | Update `JournalLineInput` type and `JournalLineBuilder` | Small | `@midcurve/shared`, `journal-line-builder.ts` |
| A5 | Update `JournalService` method signatures and queries | Medium | `journal-service.ts` |
| A6 | Update all event handlers in `post-journal-entries-on-position-events.ts` | Medium | Business logic rule |
| A7 | Update `JournalBackfillService` to pass both `positionRef` and `instrumentRef` | Small | `journal-backfill-service.ts` |
| A8 | Update tracked instruments API endpoint and toggle logic | Small | API route, service calls |

### Phase B: Calendar Periods

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| B1 | Implement `getCalendarPeriodBoundaries()` utility | Small | New file in `@midcurve/shared` |
| B2 | Replace `getPeriodDateRange()` in P&L route | Small | `pnl/route.ts` |
| B3 | Replace `subtractPeriod()` in NAV snapshot service | Small | `nav-snapshot-service.ts` |

### Phase C: Balance Sheet

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| C1 | Extend NAV snapshot schema with per-line-item columns | Medium | `schema.prisma`, migration |
| C2 | Update daily snapshot builder to compute new fields | Medium | `daily-nav-snapshot.ts` |
| C3 | Update `NavSnapshotService` with snapshot lookup by period boundary | Small | `nav-snapshot-service.ts` |
| C4 | Restructure balance sheet API endpoint with period comparison | Medium | `balance-sheet/route.ts`, API types |
| C5 | Build `BalanceSheetTable` UI component | Medium | New component in `accounting/` |

### Phase D: P&L Statement

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| D1 | Restructure P&L API response types (hierarchical + 4 categories) | Medium | `@midcurve/api-shared` types |
| D2 | Update P&L API endpoint: instrument grouping + sub-category breakdown | Medium | `pnl/route.ts` |
| D3 | Build `PnlStatement` expandable UI component | Medium-Large | New components in `accounting/` |
| D4 | Update accounting hooks for new response shapes | Small | `useBalanceSheet.ts`, `usePnl.ts` |

### Phase E: Bulk Position Refresh

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| E1 | Implement `POST /api/v1/positions/refresh-all` endpoint with `MIN(updatedAt)` guard (60s threshold) | Medium | New API route, position service query |
| E2 | Add refresh button to Summary tab header (next to period selector) | Small | `accounting-summary.tsx`, new hook |
| E3 | Handle 429 response: disable button with countdown / "recently refreshed" label | Small | UI component |

### Phase F: Cleanup

| # | Work Item | Scope | Files |
|---|-----------|-------|-------|
| F1 | Remove `AccountingSummaryCards`, `NavChart`, `PnlPositionTable` components | Small | UI components |
| F2 | Remove `usePeriodComparison` and `useNavTimeline` hooks | Small | UI hooks |
| F3 | Update `AccountingSummary` container to use new tab structure | Small | `accounting-summary.tsx` |
| F4 | Change default period from `'month'` to `'week'` | Trivial | UI + API defaults |

---

## 10. Verification

### 10.1 Balance Sheet

- With tracked positions: verify Total Assets = Total Liabilities + Total Equity
- Period comparison: change period selector and verify previous period values update
- Delta calculations: verify Δ Abs = Current - Previous, Δ % = Δ Abs / |Previous| × 100
- With no tracked positions: all values show $0.00, no errors

### 10.2 P&L Statement

- Level 0 net P&L = sum of all Level 1 net P&Ls
- Level 1 net P&L = sum of all Level 2 position net P&Ls within that instrument
- All 4 sub-categories sum to net P&L at every level
- Expand/collapse works for all levels
- Retained Earnings (end of previous) + Net P&L (period) = Retained Earnings (end of current)

### 10.3 Calendar Periods

- Select "Month" on March 15 → period shows "Mar 1 — Mar 15"
- Select "Week" on Wednesday → period starts from Monday 00:00 UTC
- Select "Quarter" in February → period starts Jan 1
- Previous period boundaries are complete calendar periods

### 10.4 Schema Refactor

- All existing journal entries have `positionRef` populated (renamed from `instrumentRef`)
- All existing journal entries have `instrumentRef` populated (backfilled pool hash)
- New journal entries from live events populate both `positionRef` and `instrumentRef`
- `TrackedPosition` table exists with `positionRef` column
- Old `tracked_instruments` table no longer exists

### 10.5 Account 4001 Migration

- Existing fee accrual journal lines (previously posted to account 4000 with `fee_accrual` domain event type) have been migrated to account 4001
- New fee accrual events post to account 4001 (`ACCRUED_FEE_INCOME_REVENUE`)
- Fee collection events continue posting to account 4000 (`FEE_INCOME`)
- P&L query: `GROUP BY accountCode` cleanly separates collected vs accrued fee income without needing `domainEventType` filtering

### 10.6 Bulk Position Refresh

- `POST /api/v1/positions/refresh-all` refreshes all tracked positions and returns `{ refreshedCount, oldestUpdatedAt }`
- If `MIN(updatedAt)` across all tracked positions is less than 60s ago, endpoint returns 429 with `{ skipped: true, retryAfter }` — no positions are refreshed
- With no tracked positions: returns `{ refreshedCount: 0 }` (no error)
- UI refresh button triggers the endpoint, shows loading state, and disables on 429 with `retryAfter` countdown
