# Double-Entry Accounting System — Phase 1
## Product Requirements Document · Midcurve Finance

**Version 1.0 | February 2026**
**Status: DRAFT | Classification: Internal**

---

## 1. Overview & Goals

### 1.1 Problem Statement

Midcurve currently tracks LP position performance via the `PositionLedgerEvent` table and per-position PnL fields (`currentValue`, `currentCostBasis`, `realizedPnl`, `unrealizedPnl`, `collectedFees`, `unClaimedFees`). All values are denominated in the position's quote token.

This works for individual position views but has four gaps:

1. **No cross-position aggregation.** There is no portfolio-level NAV or P&L. Each position is an island.
2. **No period-over-period comparison.** Position values are overwritten on each refresh — there is no historical time-series of portfolio value.
3. **No reporting currency.** Everything is in quote token units. A user with WETH/USDC and PAXG/USDC positions sees PnL in USDC, but a user with WETH/WBTC sees PnL in WBTC — there is no unified USD (or EUR, etc.) view.
4. **No double-entry audit trail.** The existing ledger is a running-total ledger (single-entry). There is no formal classification of capital vs income vs expenses, and no balanced debit/credit entries.

### 1.2 Solution

A **double-entry journal system** that runs as a parallel layer alongside the existing ledger. It consumes the same domain events via RabbitMQ, produces balanced journal entries with a formal Chart of Accounts, and enables:

- **Balance Sheet (NAV Report):** Total portfolio value across all positions, broken down by asset category.
- **P&L Statement:** Income (fees, realized gains) minus expenses (realized losses, gas), with unrealized mark-to-market changes, broken down by protocol → pool → position.
- **Period Comparison:** Side-by-side NAV snapshots for any two dates, with absolute and percentage change.
- **Reporting Currency:** All values normalized to a user-chosen currency (default: USD) using external price feeds.

### 1.3 Design Principles

- **Parallel, not replacement.** The journal system does not modify the existing `PositionLedgerEvent` table or Position PnL fields. It reads domain events and produces its own data. The existing fields remain the source of truth for the UI dashboard in Phase 1.
- **Mutable ledger.** Journal entries for a position are deleted when the position itself is deleted. Corrections (e.g., chain reorgs) are handled by deleting the affected entries. The journal serves user insight, not audit compliance.
- **Double-entry bookkeeping.** Every entry produces balanced lines (total debits = total credits in quote token units).
- **Position-scoped boundary.** The system tracks LP positions only, not wallet-level token holdings. Tokens entering a position are capital contributions; tokens leaving are capital returns.
- **Instrument-agnostic.** The journal references instruments by their immutable hash identifier (`instrumentRef`, e.g., `"uniswapv3/1/12345"`), not by foreign key. This allows the journal to track any instrument type (LP positions, lending positions, perpetuals) without schema coupling to specific tables.
- **Mark-to-Market.** Positions are valued at fair value at each daily snapshot, with changes flowing through the P&L.

### 1.4 Non-Goals

- Tax reporting or jurisdiction-specific calculations.
- Integration with external accounting software (QuickBooks, Xero).
- Tracking assets outside concentrated liquidity positions.
- Real-time per-block accounting (operates on daily snapshots + event-driven entries).
- Staking positions, perpetual positions, or position transfers (deferred to Phase 2).

---

## 2. Scope — Phase 1 Boundaries

### 2.1 In Scope

| Area | Details |
|------|---------|
| Data models | `AccountDefinition`, `JournalEntry`, `JournalLine`, `NAVSnapshot` tables; `reportingCurrency` field on `User` |
| Journal consumer | New business rule subscribing to `position.*` domain events, creating journal entries |
| Daily M2M cron | Scheduled job emitting `position.state.refreshed` for all active positions, then creating NAV snapshots |
| Reporting currency | CoinGecko spot price fetch (quote token → reporting currency); dual-amount storage on journal lines |
| API endpoints | Balance sheet, P&L breakdown, period comparison, user reporting currency preference |
| Chart of Accounts | 11 accounts covering LP positions, fees, capital, realized/unrealized gains/losses, gas |
| UI views | New "Summary" tab in the Dashboard alongside the existing "Positions" tab. Summary contains Balance Sheet, P&L breakdown, and Period Comparison. "Positions" remains the default tab. |

### 2.2 Out of Scope (Phase 2+)

| Area | Rationale |
|------|-----------|
| Staking positions | Requires new events (`position.staked`, `position.unstaked`), staking-specific accounts (1110, 1210, 1220, 4500), and staking contract registry |
| Perpetual positions | Requires liability accounts (2000, 2100), funding income/expense (4200, 5200) |
| Position transfers | Requires transfer classification UI, new events (`position.transferred.out`), transfer-specific accounts (3400, 5600) |
| Historical backfill | Generating journal entries from existing `PositionLedgerEvent` records for positions created before this feature ships. Flagged as open question. |
| Multi-wallet aggregation | Consolidation across multiple imported wallets |

---

## 3. System Context — What Already Exists

This section documents the existing infrastructure that the journal system builds on. No changes to these components are proposed (except where explicitly noted).

### 3.1 Position Ledger (`PositionLedgerEvent`)

An append-only, chained ledger (`packages/midcurve-database/prisma/schema.prisma`). Each event stores:

- **Event identity:** `id`, `positionId`, `previousId` (chain link), `inputHash` (dedup key: `uniswapv3/{chainId}/{txHash}/{blockHash}/{logIndex}`)
- **Event type:** `INCREASE_POSITION` | `DECREASE_POSITION` | `COLLECT`
- **Financial data:** `poolPrice`, `token0Amount`, `token1Amount`, `tokenValue` (all bigint as string, quote token units)
- **Running totals:** `deltaCostBasis`/`costBasisAfter`, `deltaPnl`/`pnlAfter`, `deltaCollectedFees`/`collectedFeesAfter`
- **Protocol-specific config JSON:** `blockNumber`, `txHash`, `blockHash`, `deltaL`, `liquidityAfter`, `feesCollected0`/`feesCollected1`, `uncollectedPrincipal0After`/`uncollectedPrincipal1After`, `sqrtPriceX96`

The ledger handles chain reorgs via `deleteAllByBlockHash()`, followed by a `position.liquidity.reverted` domain event.

### 3.2 Domain Events

Defined in `packages/midcurve-services/src/events/types.ts`. Published via a transactional outbox pattern — events are written to `DomainEventOutbox` in the same Prisma transaction as state changes, then published to RabbitMQ by a background worker.

**Position events relevant to the journal:**

| Event | Payload | When Emitted |
|-------|---------|--------------|
| `position.created` | Full `PositionJSON` | Position first imported |
| `position.liquidity.increased` | `positionId`, `liquidityDelta`, `liquidityAfter`, `token0Amount`, `token1Amount`, `eventTimestamp` | On-chain `IncreaseLiquidity` |
| `position.liquidity.decreased` | Same structure as increased | On-chain `DecreaseLiquidity` |
| `position.fees.collected` | `positionId`, `fees0`, `fees1`, `feesValueInQuote`, `eventTimestamp` | On-chain `Collect` (fee portion) |
| `position.closed` | Full `PositionJSON` | Liquidity drops to 0, all principal collected |
| `position.burned` | Full `PositionJSON` | NFT burned on-chain |
| `position.deleted` | Full `PositionJSON` | User removes position from tracking |
| `position.liquidity.reverted` | `positionId`, `blockHash`, `deletedCount`, `revertedAt` | Chain reorg detected |
| `position.state.refreshed` | `positionId`, `currentValue`, `unrealizedPnl`, `liquidity` | **Defined but never emitted today** |

### 3.3 Position Model

The `Position` table stores aggregate PnL fields (`currentValue`, `currentCostBasis`, `realizedPnl`, `unrealizedPnl`, `collectedFees`, `unClaimedFees`) — all in quote token raw units as bigint strings. The `isToken0Quote` flag determines quote/base orientation.

Position state is refreshed **event-driven only** (via `UpdatePositionOnLiquidityEventRule` consuming RabbitMQ events). There is no scheduled/cron refresh.

### 3.4 Existing Calculation Functions

Located in `packages/midcurve-services/src/utils/uniswapv3/ledger-calculations.ts`:

| Function | Purpose | Reused By Journal? |
|----------|---------|-------------------|
| `calculatePoolPriceInQuoteToken()` | sqrtPriceX96 → quote token price per base token | Yes — daily M2M cron |
| `calculateTokenValueInQuote()` | Token amounts → single quote token value | Yes — daily M2M cron |
| `calculateProportionalCostBasis()` | Proportional cost basis on partial withdrawal | No — journal reads `deltaCostBasis` from ledger event |
| `separateFeesFromPrincipal()` | Splits COLLECT into fee income vs returned principal | No — journal reads `deltaCollectedFees` from ledger event |

### 3.5 Existing Infrastructure

| Component | Location | Status |
|-----------|----------|--------|
| node-cron scheduler | `apps/midcurve-business-logic/src/scheduler/` | Working. Two jobs registered. New cron rules use `this.registerSchedule()`. |
| viem multicall | `packages/midcurve-services/src/utils/uniswapv3/pool-reader.ts` | Working. Batches pool `slot0` reads. |
| CoinGecko client | `packages/midcurve-services/src/clients/coingecko/coingecko-client.ts` | **Metadata only** (logos, market caps). Does not fetch spot prices. Needs `/simple/price` integration. |
| RabbitMQ topology | `packages/midcurve-services/src/events/topology.ts` | Working. `domain-events` exchange, routing keys per event type. |

---

## 4. Chart of Accounts — Phase 1

Account numbers are internal. The user interface shows descriptive labels only.

### Assets (1xxx)

| Code | Name | Normal Side | Description |
|------|------|-------------|-------------|
| 1000 | LP Position at Cost | Debit | Cost basis of active positions. Debited on open/increase, credited on close/decrease. |
| 1001 | LP Position Unrealized Adjustment | Debit | Mark-to-market adjustment above/below cost. Debited when value rises, credited when value falls. Net of 1000 + 1001 = fair value. |
| 1002 | Accrued Fee Income | Debit | Unclaimed fees on active positions. Debited as fees accrue, credited when fees are collected. |

### Equity (3xxx)

| Code | Name | Normal Side | Description |
|------|------|-------------|-------------|
| 3000 | Contributed Capital | Credit | Total capital invested into positions (subscriptions). Credited on each deposit. |
| 3100 | Capital Returned | Debit | Total capital returned from closed positions and collected fees (redemptions). Debited on each withdrawal. |

*Keeping these separate enables reporting "total capital deployed" vs "total capital returned" — a metric useful for understanding capital efficiency.*

### Revenue (4xxx)

| Code | Name | Normal Side | Description |
|------|------|-------------|-------------|
| 4000 | Fee Income | Credit | LP fees earned (accrued at M2M time, resolved at collection time). |
| 4100 | Realized Gains | Credit | Gains crystallized upon position decrease or close. |
| 4200 | Unrealized Gains | Credit | Positive mark-to-market changes on open positions. |

### Expenses (5xxx)

| Code | Name | Normal Side | Description |
|------|------|-------------|-------------|
| 5000 | Realized Losses | Debit | Losses crystallized upon position decrease or close. |
| 5100 | Gas Expense | Debit | On-chain transaction costs (when data is available). |
| 5200 | Unrealized Losses | Debit | Negative mark-to-market changes on open positions. |

### Sub-Ledger Granularity

Each `JournalLine` carries an `instrumentRef` — the instrument's immutable hash identifier (e.g., `"uniswapv3/1/12345"`). This means every account implicitly has per-instrument sub-ledgers without needing per-instrument account codes. Queries can aggregate at any level: instrument, pool (via hash prefix or lookup), protocol (via hash protocol segment), or portfolio.

### Future Phase 2 Accounts (Not Implemented)

For reference, the following accounts are planned for Phase 2:

- **1110 LP Positions (Staked)**, **1210 Accrued Fees (Staked)**, **1220 Accrued Staking Rewards**, **4500 Staking Reward Income** — for staking/gauge positions
- **2000 Open Perp Positions**, **2100 Unrealized Funding**, **4200 Funding Income**, **5200 Funding Expense** — for perpetual positions
- **3400 Owner Withdrawals**, **5600 Transfer Loss** — for position transfers out

---

## 5. Data Models

Four new entities are added to the database. Field descriptions use type conventions consistent with the existing schema: `String` for bigint values, `DateTime` for timestamps, `Json` for structured data.

**Database schema:** All four accounting models (`AccountDefinition`, `JournalEntry`, `JournalLine`, `NAVSnapshot`) live in a dedicated PostgreSQL schema `accounting`, separate from the existing `public` schema. This requires enabling Prisma's `multiSchema` preview feature and annotating each model with `@@schema("accounting")`. The `User` model (which receives a new `reportingCurrency` field) remains in `public`.

### 5.1 AccountDefinition

Seeded once with the Phase 1 chart. Rarely changes.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| code | Int (unique) | Account number (1000, 3000, 4000, etc.) |
| name | String | Human-readable name |
| description | String? | Longer explanation |
| category | String | `"asset"` \| `"liability"` \| `"equity"` \| `"revenue"` \| `"expense"` |
| normalSide | String | `"debit"` \| `"credit"` — the side that increases this account |
| isActive | Boolean | Soft-disable flag (default: true) |

**Indexes:** `code` (unique), `category`

### 5.2 JournalEntry

One entry per accounting event. Contains one or more balanced lines.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| createdAt | DateTime | Row creation time |
| userId | String (FK → User) | Owner of this entry |
| domainEventId | String? | References `DomainEvent.id` for traceability |
| domainEventType | String? | Event type discriminator (e.g., `"position.liquidity.increased"`) |
| ledgerEventRef | String? | Loose string reference to the originating ledger event ID (e.g., a PositionLedgerEvent ID). No FK constraint — allows future instrument types with their own ledger tables. |
| entryDate | DateTime | Business date of the entry (block timestamp for on-chain events, snapshot date for M2M) |
| description | String | Human-readable (e.g., `"Liquidity increase: uniswapv3/1/12345"`) |
| memo | String? | Optional additional context |
**Indexes:** `(userId, entryDate)`, `domainEventId` (for idempotency check), `ledgerEventRef`

### 5.3 JournalLine

Individual debit or credit line within a journal entry.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| journalEntryId | String (FK → JournalEntry) | Parent entry |
| accountId | String (FK → AccountDefinition) | Which account this line affects |
| instrumentRef | String? | Instrument hash identifier (e.g., `"uniswapv3/1/12345"`). No FK constraint — allows any instrument type. |
| side | String | `"debit"` \| `"credit"` |
| amountQuote | String | Amount in quote token raw units (bigint as string). Same scale as `Position.currentValue`. |
| amountReporting | String? | Amount in reporting currency (bigint as string, scaled by 10^8 for precision). Example: $3,000.50 → `"300050000000"` |
| reportingCurrency | String? | ISO 4217 code (e.g., `"USD"`, `"EUR"`) |
| exchangeRate | String? | Quote token → reporting currency rate at entry time (bigint as string, scaled by 10^8) |

**Indexes:** `journalEntryId`, `accountId`, `instrumentRef`, `(accountId, instrumentRef)`

**Invariant:** For every `JournalEntry`, the sum of `amountQuote` on debit lines must equal the sum of `amountQuote` on credit lines.

### 5.4 NAVSnapshot

Daily portfolio-level snapshot. The foundation for period comparisons and the Balance Sheet view.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| createdAt | DateTime | Row creation time |
| userId | String (FK → User) | Owner |
| snapshotDate | DateTime | The date this snapshot represents (midnight UTC) |
| snapshotType | String | `"daily"` \| `"manual"` |
| reportingCurrency | String | Currency of all amounts below |
| valuationMethod | String | `"pool_price"` for Phase 1 (Pool Price Single Conversion) |
| totalAssets | String | Sum of all asset account balances (bigint string, scaled 10^8) |
| totalLiabilities | String | Sum of all liability account balances (always `"0"` in Phase 1) |
| netAssetValue | String | `totalAssets - totalLiabilities` |
| totalContributedCapital | String | Cumulative balance of account 3000 (bigint string, scaled 10^8) |
| totalCapitalReturned | String | Cumulative balance of account 3100 (bigint string, scaled 10^8) |
| totalAccumulatedPnl | String | Net of all revenue minus expense account balances (bigint string, scaled 10^8) |
| periodFeeIncome | String | Fee income since last snapshot |
| periodRealizedPnl | String | Net realized gain/loss since last snapshot |
| periodUnrealizedPnl | String | Change in unrealized P&L since last snapshot |
| periodGasExpense | String | Gas expense since last snapshot |
| activePositionCount | Int | Number of active positions at snapshot time |
| positionBreakdown | Json | Array of per-instrument data: `{ instrumentRef, poolSymbol, currentValueReporting, costBasisReporting, unrealizedPnlReporting, accruedFeesReporting }` |

**Indexes:** `(userId, snapshotDate, snapshotType)` (unique), `(userId, snapshotDate)`

### 5.5 User Model Change

Add one field to the existing `User` model:

| Field | Type | Description |
|-------|------|-------------|
| reportingCurrency | String (default: `"USD"`) | User's chosen reporting currency (ISO 4217) |

---

## 6. Domain Events → Journal Entries

Each domain event maps to one or more balanced journal entries. The journal consumer looks up the corresponding `PositionLedgerEvent` (via `ledgerEventRef` or by matching `instrumentRef` + `eventTimestamp`) to obtain exact financial amounts.

### 6.1 position.created

The position is first imported and appears in the system. The initial capital contribution equals the cost basis from the first `INCREASE_POSITION` ledger event.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 1000 LP Position at Cost | Debit | `costBasisAfter` from first ledger event |
| 2 | 3000 Contributed Capital | Credit | same |

*No P&L effect. The position is recorded at cost basis.*

**Amount source:** The `position.created` payload is a full `PositionJSON` containing `currentCostBasis`. Alternatively, query the first `PositionLedgerEvent` for the position.

### 6.2 position.liquidity.increased

Additional liquidity deposited into an existing position.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 1000 LP Position at Cost | Debit | `deltaCostBasis` from ledger event |
| 2 | 3000 Contributed Capital | Credit | same |

**Amount source:** The corresponding `PositionLedgerEvent` (type `INCREASE_POSITION`) provides `deltaCostBasis` — the cost basis increase from this deposit.

### 6.3 position.liquidity.decreased

Partial or full withdrawal of liquidity. Proportional cost basis is derecognized, and the difference between received value and cost basis is realized as gain or loss.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 1000 LP Position at Cost | Credit | `abs(deltaCostBasis)` from ledger event |
| 2 | 3100 Capital Returned | Debit | `tokenValue` from ledger event |
| 3a | 4100 Realized Gains | Credit | `deltaPnl` (if positive) |
| 3b | 5000 Realized Losses | Debit | `abs(deltaPnl)` (if negative) |

Only one of line 3a or 3b is created, depending on the sign of `deltaPnl`.

**Reclassification of unrealized to realized:**

If the position had accumulated unrealized gains/losses (from prior M2M entries), a proportional share must be reclassified. The proportion is `abs(deltaCostBasis) / costBasisBefore`.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 4a | 4200 Unrealized Gains | Debit | proportional cumulative unrealized gain |
| 4b | 4100 Realized Gains | Credit | same |

Or if unrealized losses:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 4a | 5200 Unrealized Losses | Credit | proportional cumulative unrealized loss |
| 4b | 5000 Realized Losses | Debit | same |

*This reclassification prevents double-counting. Net P&L remains unchanged; only the realized/unrealized split shifts.*

**Amount source:** The `PositionLedgerEvent` (type `DECREASE_POSITION`) provides `deltaCostBasis`, `deltaPnl`, and `tokenValue`. The cumulative unrealized amount is derived from the running balance in account 1001 for this position.

### 6.4 position.fees.collected

User claims accrued fees on-chain. This resolves the accrual recorded during prior `position.state.refreshed` M2M events.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 3100 Capital Returned | Debit | `feesValueInQuote` from event payload |
| 2 | 1002 Accrued Fee Income | Credit | min(`feesValueInQuote`, current 1002 balance for this position) |
| 3 | 4000 Fee Income | Credit | any excess beyond accrual (adjustment) |

If no prior accrual exists (fees collected before a M2M cycle ran), all goes to Fee Income:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 3100 Capital Returned | Debit | `feesValueInQuote` |
| 2 | 4000 Fee Income | Credit | `feesValueInQuote` |

*No new P&L effect if fees were already accrued — the income was recognized at accrual time. The delta (if any) adjusts Fee Income.*

**Amount source:** The `PositionFeesCollectedPayload` provides `feesValueInQuote`. The corresponding `PositionLedgerEvent` (type `COLLECT`) provides `deltaCollectedFees`.

### 6.5 position.state.refreshed (Mark-to-Market)

The M2M event. Triggered by the daily snapshot cron (section 8). Produces two independent sub-entries.

**Sub-entry A: Fee Accrual (change in unclaimed fees since last refresh)**

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 1002 Accrued Fee Income | Debit | Δ(unClaimedFees) |
| 2 | 4000 Fee Income | Credit | same |

*Only created if the fee delta is positive. If unclaimed fees decreased (e.g., partial collection occurred between snapshots), this is handled by the `position.fees.collected` entry instead.*

**Sub-entry B: Position Value Change (mark-to-market of liquidity, excluding fees)**

If value increased since last M2M:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 1001 LP Position Unrealized Adjustment | Debit | Δ(unrealizedPnl) |
| 2 | 4200 Unrealized Gains | Credit | same |

If value decreased since last M2M:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 5200 Unrealized Losses | Debit | abs(Δ(unrealizedPnl)) |
| 2 | 1001 LP Position Unrealized Adjustment | Credit | same |

**Amount source:** The `PositionStateRefreshedPayload` provides `currentValue` and `unrealizedPnl`. The journal consumer compares these against the last known values (from the previous journal entries for this position or from the previous snapshot).

**Note:** The current `PositionStateRefreshedPayload` does not include `unClaimedFees`. This field needs to be added to the payload for the fee accrual sub-entry. See section 12 (Open Questions).

### 6.6 position.closed

Emitted when all liquidity is removed and all principal is collected (liquidity = 0, tokensOwed = 0). The actual withdrawal was already handled by `position.liquidity.decreased` and `position.fees.collected` events. This entry handles the reclassification of any remaining unrealized P&L to realized.

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1a | 4200 Unrealized Gains | Debit | remaining unrealized gain balance (from 1001) |
| 1b | 4100 Realized Gains | Credit | same |

Or if unrealized losses remain:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1a | 5200 Unrealized Losses | Credit | remaining unrealized loss balance |
| 1b | 5000 Realized Losses | Debit | same |

*How this zeroes account 1001:* When unrealized losses were originally recorded (section 6.5), account 1001 was credited and 5200 was debited. Crediting 5200 here reverses the original 5200 debit; debiting 5000 records the loss as realized. Since the original loss entries were `DR 5200 / CR 1001`, reversing 5200 implicitly reverses 1001's credit balance. After this entry, accounts 1001, 4200, and 5200 should all have zero balances for this position.

*If any residual balance remains in 1000 (should not happen since the final decrease zeroed it), write it off as a Realized Loss.*

**Amount source:** The remaining unrealized amount is determined by the current balance of account 1001 for this position, computed from the journal. If 1001 has a net debit balance → unrealized gain case. If 1001 has a net credit balance → unrealized loss case.

### 6.7 position.burned

The NFT is burned on-chain. This is a status event — no financial journal entry unless gas data is available.

If gas cost data is available from the event context:

| Line | Account | Side | Amount (Quote) |
|------|---------|------|----------------|
| 1 | 5100 Gas Expense | Debit | gas cost in quote token units |
| 2 | 3000 Contributed Capital | Credit | same |

*Gas is treated as an additional capital contribution that is immediately expensed.*

**Defensive:** If any residual book value remains in accounts 1000/1001/1002 for this position (should not happen if `position.closed` ran first), write it off as a Realized Loss.

### 6.8 position.deleted

Application-level event: position is removed from the user's tracking view. **All `JournalEntry` rows (and cascading `JournalLine` rows) for this position are deleted.** This cleans up the journal completely for removed positions, keeping it uncluttered.

### 6.9 position.liquidity.reverted (Chain Reorg)

A chain reorg was detected and ledger events were removed. The journal deletes the affected entries directly.

**Process:**

1. Query `JournalEntry` rows where `ledgerEventRef` matches any ledger event that was in the reverted block.
2. Delete those entries (cascade deletes `JournalLine` rows).

**Identifying affected entries:** The `PositionLiquidityRevertedPayload` provides the `blockHash`. The journal consumer queries its own `JournalEntry` table for entries with `ledgerEventRef` values that belonged to events in that block. Since the ledger events themselves are already deleted by the time the domain event arrives, the journal must maintain this mapping internally (via `ledgerEventRef`).

---

## 7. Reorg Handling

The existing system already handles reorgs at the ledger level:

1. The `midcurve-onchain-data` service detects `removed: true` events.
2. The `UniswapV3LedgerService.deleteAllByBlockHash()` removes the affected ledger events.
3. A `position.liquidity.reverted` domain event is emitted.
4. The position state is refreshed from the corrected ledger.

The journal layer subscribes to step 3 and deletes the affected journal entries directly (section 6.9). No status column or reversal entries are needed — affected entries are simply removed, and the corrected on-chain events will produce new journal entries as they arrive.

---

## 8. Daily Snapshot Mechanism

### 8.1 Overview

A daily cron job marks all active positions to market and creates a portfolio-level NAV snapshot for each user. This is the first use of the `position.state.refreshed` event type, which is defined in the codebase but never emitted today.

### 8.2 Architecture

A new `DailyNavSnapshotRule` business rule in `apps/midcurve-business-logic/src/rules/accounting/`, following the same pattern as `RefreshCoingeckoTokensRule`.

**Schedule:** `0 0 * * *` (midnight UTC daily)

### 8.3 Execution Flow

```
1. Query all active positions, grouped by poolId and chainId
2. Batch multicall: pool slot0() per unique pool → get sqrtPriceX96
3. For each position:
   a. Calculate new currentValue using calculateTokenValueInQuote()
   b. Calculate new unrealizedPnl (currentValue - currentCostBasis)
   c. Calculate new unClaimedFees from on-chain tokensOwed (batched static collect() call)
   d. Emit position.state.refreshed domain event (via outbox, in Prisma transaction)
   e. Update Position model fields (currentValue, unrealizedPnl, unClaimedFees)
4. Fetch reporting currency rates from CoinGecko (one call per unique quote token)
5. For each user with active positions:
   a. Aggregate position values into reporting currency
   b. Create NAVSnapshot row
```

### 8.4 Batch Efficiency

For a user with N positions across P pools:
- P `slot0()` calls (pool prices) — batched into 1 multicall per chain
- N `collect()` static calls (unclaimed fees) — batched into multicalls of ~50 per chain
- 1 CoinGecko API call (all unique quote token IDs in a single request)

### 8.5 Snapshot vs Journal Entry Timing

The NAV snapshot is created **synchronously** at the end of the cron job, aggregating directly from the updated Position model fields. It does not wait for the journal consumer to process the `position.state.refreshed` events — the journal entries are written asynchronously for audit trail purposes.

This means the snapshot and journal may have brief timing differences, but the snapshot is always based on the same on-chain data that the journal entries will eventually reflect.

---

## 9. Reporting Currency & Valuation

### 9.1 Valuation Method: Pool Price Single Conversion

The position's total value is first expressed in the quote token using the pool's internal price (sqrtPriceX96), then converted to the reporting currency using a single external price feed.

```
Position Value (reporting) = calculateTokenValueInQuote(token0, token1, sqrtPriceX96) × CoinGeckoPrice(quoteToken/reportingCurrency)
```

This matches the existing `calculateTokenValueInQuote()` function exactly — the only new step is the final multiplication by the external rate.

### 9.2 Rationale

- **Consistency with realized value:** When a user withdraws, they receive tokens at the pool price. The pool price reflects what the user would actually realize.
- **Simplicity:** Only one external price feed per pool (quote token → reporting currency).
- **No FX layer needed:** All value changes flow through Unrealized Gains/Losses. No separate FX accounts.
- **IFRS 13 alignment:** The pool is the principal market for the LP position.

### 9.3 External Price Source

CoinGecko `/simple/price` endpoint. The existing `Token` model has a `coingeckoId` field, and the `CoingeckoToken` lookup table maps chain-specific addresses to CoinGecko IDs.

**What needs to be added:** A new method on `CoinGeckoClient` (or a thin wrapper) that fetches spot prices for a set of `coingeckoId` values in a target currency. The existing client only fetches metadata (logos, market caps) — it does not call the `/simple/price` endpoint.

### 9.4 Dual-Amount Storage

Each `JournalLine` stores two amounts:
- `amountQuote` — the primary amount in quote token raw units (bigint string, same scale as all existing PnL fields)
- `amountReporting` — the equivalent in reporting currency (bigint string, scaled by 10^8 for precision)

The `exchangeRate` field captures the rate used, enabling audit and recalculation.

### 9.5 Reporting Currency Selection

Users can set their preferred reporting currency (default: USD) via a new API endpoint. The currency is stored on the `User` model.

**Currency switch:** When a user changes their reporting currency, the `amountReporting` values on existing journal lines are **not** mutated. Instead, the reporting views recalculate on the fly using the stored `amountQuote` and the historical exchange rate for each entry's date. This is a read-side operation.

For NAV snapshots, historical snapshots remain in their original reporting currency. New snapshots use the updated currency. Period comparisons between snapshots in different currencies would require conversion — this edge case can be handled by re-computing the older snapshot's values at the new currency.

### 9.6 Valuation Method Tag

Each `NAVSnapshot` stores a `valuationMethod` field (`"pool_price"` for Phase 1). If the system is upgraded to individual market pricing in the future, historical snapshots remain valid and comparable because each records which method was used.

---

## 10. User-Facing Reports

The Dashboard gains a new **"Summary"** tab alongside the existing **"Positions"** tab (extending the existing `DashboardTabs` component). "Positions" remains the default tab.

### Layout — Stacked Sections

The Summary tab uses a vertical stack of full-width cards, top to bottom:

1. **NAV Headline** — Full-width card. Left side: "Net Asset Value" label with large formatted amount and period change percentage (green/red). Right side: reporting currency selector dropdown.

2. **Balance Sheet** — Full-width card. Two sections separated by a horizontal divider: Assets (LP Positions, Accrued Fees, Total Assets) and Equity (Capital Invested, Capital Returned, Accumulated P&L, Total Equity). Label-value rows with right-aligned amounts.

3. **Period Comparison** — Full-width card. Pill toggle at the top for period selection (Day | Week | Month | Quarter | Year). Table with columns: category, start value, end value, absolute change, percentage change.

4. **P&L Breakdown** — Full-width card. Collapsible tree: Protocol → Pool → Position. Columns: Fee Income, Price P&L, Total. Summary footer row with Gross P&L, Operating Expenses, Net P&L.

All cards use the existing card pattern (`bg-slate-800/50`, `border-slate-700/50`, `rounded-xl`). All views respect the user's reporting currency. Account numbers and technical terminology are hidden — the user sees descriptive labels only.

### 10.1 Balance Sheet (NAV Report)

Displays the current Net Asset Value as a simplified asset/equity breakdown.

| Category | Details | Value |
|----------|---------|------:|
| LP Positions | Per protocol → pool → position | $94,635.72 |
| Accrued Fees | Unclaimed fees per position | $19.68 |
| **Total Assets** | | **$94,655.40** |
| | | |
| Capital Invested | Total contributions into positions | $120,000.00 |
| Capital Returned | Returned from closes and fee claims | -$12,500.00 |
| Accumulated P&L | Cumulative gains and losses | -$12,844.60 |
| **Total Equity** | | **$94,655.40** |

*NAV = Total Assets = Total Equity (no liabilities in Phase 1).*

**Data source:** Latest `NAVSnapshot` for the user. "LP Positions" = sum of accounts 1000 + 1001. "Accrued Fees" = account 1002. "Capital Invested" = account 3000. "Capital Returned" = account 3100. "Accumulated P&L" = net of all revenue minus expense accounts.

### 10.2 Period Comparison

Side-by-side NAV comparison for any two dates, with absolute and percentage change. The user selects the comparison period via a toggle: Day, Week, Month, Quarter, Year.

| | Start | End | Δ | % |
|---|------:|----:|--:|--:|
| LP Positions | $91,200.00 | $94,635.72 | +$3,435.72 | +3.8% |
| Accrued Fees | $0.00 | $19.68 | +$19.68 | — |
| **Total Assets (NAV)** | **$91,200.00** | **$94,655.40** | **+$3,455.40** | **+3.8%** |

**Data source:** Two `NAVSnapshot` rows (start date and end date). Differences computed at query time.

### 10.3 P&L Breakdown (Income Statement)

Structured hierarchically: Protocol → Pool → Position → Component. Each level is collapsible in the UI.

**Level 1: Protocol summary**

| Protocol | Fee Income | Price P&L | Total |
|----------|----------:|----------:|------:|
| Uniswap V3 | +$1,607.34 | -$26,079.29 | -$24,471.95 |

**Level 2: Pool → Position detail**

| Pool | Position | Fee Income | Price P&L | Total |
|------|----------|----------:|----------:|------:|
| WETH/USDC 0.30% · Base | #4691802 | +$8.14 | -$1.09 | +$7.05 |
| PAXG/USDC 0.30% · ETH | #1186160 | +$187.20 | +$607.59 | +$794.79 |

**Level 3: Operating Expenses**

| Category | Amount |
|----------|-------:|
| Gas / Transaction Costs | -$82.50 |
| **Total Expenses** | **-$82.50** |

**Summary**

| | Amount |
|---|-------:|
| Gross P&L (all positions) | -$24,471.95 |
| Operating Expenses | -$82.50 |
| **Net P&L (Period)** | **-$24,554.45** |

**Data source:** `JournalLine` rows filtered by date range and grouped by `instrumentRef` → `accountId`. Fee Income = account 4000. Price P&L = accounts 4100 + 4200 - 5000 - 5200. Gas = account 5100.

---

## 11. Implementation Sequencing

| Step | Description | Depends On |
|------|-------------|------------|
| 1 | **Database schema.** Add `AccountDefinition`, `JournalEntry`, `JournalLine`, `NAVSnapshot` to Prisma schema. Add `reportingCurrency` to `User`. Run migration. Seed chart of accounts. | — |
| 2 | **Service layer.** Create `JournalService` and `NavSnapshotService` in `@midcurve/services`. Add shared types to `@midcurve/shared`. | Step 1 |
| 3 | **Journal consumer.** Create `PostJournalEntriesOnPositionEventsRule` in `midcurve-business-logic`. Subscribe to `position.*` domain events. Implement event-to-journal mapping for all 9 event types. | Step 2 |
| 4 | **Daily M2M cron.** Create `DailyNavSnapshotRule` in `midcurve-business-logic`. Add CoinGecko spot price method. Implement batched multicall + snapshot creation. | Step 2 |
| 5 | **API endpoints.** Add balance sheet, P&L breakdown, period comparison, and user preferences endpoints to `midcurve-api`. | Step 2 |
| 6 | **UI views.** Add "Summary" tab to the Dashboard with Balance Sheet, P&L breakdown, and Period Comparison views. "Positions" tab remains the default. | Step 5 |

### Key Files to Create

| File | Package | Purpose |
|------|---------|---------|
| `services/journal/journal-service.ts` | `@midcurve/services` | Journal entry CRUD, balance queries, idempotency check |
| `services/nav-snapshot/nav-snapshot-service.ts` | `@midcurve/services` | Snapshot creation and retrieval |
| `rules/accounting/post-journal-entries-on-position-events.ts` | `midcurve-business-logic` | RabbitMQ consumer → journal entries |
| `rules/accounting/daily-nav-snapshot.ts` | `midcurve-business-logic` | Daily cron → M2M + snapshots |

### Key Files to Modify

| File | Change |
|------|--------|
| `packages/midcurve-database/prisma/schema.prisma` | Enable `multiSchema` preview feature, add `schemas = ["public", "accounting"]` to datasource, add 4 new models with `@@schema("accounting")`, add `reportingCurrency` to User |
| `apps/midcurve-business-logic/src/workers/index.ts` | Register the 2 new business rules |
| `packages/midcurve-services/src/clients/coingecko/coingecko-client.ts` | Add spot price fetch method |
| `packages/midcurve-services/src/events/types.ts` | Add `unClaimedFees` to `PositionStateRefreshedPayload` (if decided) |

### Existing Code to Reuse

| Function | File | Used By |
|----------|------|---------|
| `calculateTokenValueInQuote()` | `packages/midcurve-services/src/utils/uniswapv3/ledger-calculations.ts` | Daily M2M cron |
| `calculatePoolPriceInQuoteToken()` | same | Daily M2M cron |
| Multicall pool reader | `packages/midcurve-services/src/utils/uniswapv3/pool-reader.ts` | Daily M2M cron |
| `DomainEventPublisher` outbox pattern | `packages/midcurve-services/src/events/` | Daily M2M cron (emitting events) |
| `BusinessRule` base class + `registerSchedule()` | `apps/midcurve-business-logic/src/rules/` | Both new rules |

---

## 12. Design Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | **Historical backfill.** Generate journal entries from existing `PositionLedgerEvent` records? | **No.** Journal starts clean from deployment. No backfill migration. |
| 2 | **Gas cost tracking.** Domain events lack consistent gas cost data. | **Deferred to Phase 2.** No gas tracking in Phase 1. |
| 3 | **Reporting currency precision.** Is 10^8 scaling sufficient for `amountReporting`? | **Yes.** 10^8 (8 decimal places) is sufficient. |
| 4 | **`PositionStateRefreshedPayload` expansion.** Add `unClaimedFees`? | **Yes.** Add `unClaimedFees: string` to the payload. |
| 5 | **Journal vs Position model as source of truth.** | **Position model remains source of truth.** Journal is advisory only in Phase 1. |
| 6 | **Multi-user snapshot batching.** | **Single pass for Phase 1.** Per-user chunking deferred to Phase 2. |
| 7 | **Exchange rate for non-USD currencies.** | **Use CoinGecko's `vs_currencies` directly.** No intermediate USD conversion. |
| 8 | **Position journal lifecycle.** | **Closed positions retain entries** (for P&L history). **Deleted positions have all entries removed.** |

---

## Appendix A: Accounting Primer

For readers unfamiliar with double-entry bookkeeping:

- **Debit** increases asset and expense accounts; decreases equity and revenue accounts.
- **Credit** increases equity and revenue accounts; decreases asset and expense accounts.
- Every transaction has equal total debits and credits — the books always balance.
- **Assets = Liabilities + Equity** (the accounting equation). In Phase 1 with no liabilities: **Assets = Equity**.
- **Mark-to-Market** means revaluing assets to current market prices at regular intervals, with the change recorded as unrealized gain or loss.
- **Realized** means a gain or loss has been crystallized by an actual transaction (withdrawal, close). **Unrealized** means the gain or loss exists on paper only.
