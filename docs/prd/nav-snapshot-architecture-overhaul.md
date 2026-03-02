# NAV Snapshot Architecture Overhaul
## Product Requirements Document · Midcurve Finance

**Version 1.0 | March 2026**
**Status: DRAFT | Classification: Internal**
**Depends on: [Double-Entry Accounting Phase 1](finished/double-entry-accounting-phase1.md), [Portfolio Balance Sheet & P&L](finished/portfolio-balance-sheet-pnl.md)**

---

## 1. Overview & Goals

### 1.1 Problem Statement

The NAV snapshot system has two architectural flaws that produce incorrect Balance Sheet data:

1. **Stale snapshots after position removal.** When a user deletes or untracks a position, journal entries are cascade-deleted (via `TrackedPosition`), but NAV snapshots are not updated. The snapshots retain journal-derived balances (equity, retained earnings) from the deleted position while the asset-side values (computed from position data) are zero — producing an unbalanced "Previous" column on the Balance Sheet.

2. **Dual calculation paths.** The current period's Balance Sheet is computed on-demand from live journal balances (`getUserAccountBalanceReporting`), while comparison periods read from pre-computed NAV snapshots. These two paths use different data sources (current journal state vs. snapshot-time journal state), different price feeds (spot vs. historical), and different aggregation scopes (user-level vs. position-level). This creates subtle inconsistencies between columns that cannot be fixed by patching either path.

### 1.2 Solution

Four changes that together eliminate both problems:

1. **Snapshot recomputation on position removal.** When a position is deleted, all affected snapshots are detected via a journal hash and recomputed from the current journal state. This treats stale snapshots as a cache invalidation problem.

2. **Snapshot retention policy.** A tiered retention scheme (daily → weekly → monthly → quarterly → yearly) bounds storage growth while preserving long-term history.

3. **On-chain state cache.** Immutable on-chain data (pool state, position state, prices) is cached per snapshot, making recomputation a pure local calculation with no RPC calls. Cache entries are owned by their snapshot and cascade-deleted with it.

4. **Snapshot-only reporting.** All reporting — including the current period — reads exclusively from snapshots. The live journal query path is removed. Both columns use the same calculation methodology.

### 1.3 Design Principles

- **Cache invalidation, not reversal bookings.** The journal's deletion-based cleanup is correct. Snapshots are a derived cache. When the source changes, recompute the cache.
- **Per-snapshot cache ownership.** Each snapshot owns its on-chain state cache entries (1-to-many). No sharing, no reference counting. When a snapshot is pruned, its cache entries are cascade-deleted. Storage is cheap; simplicity is valuable.
- **Single calculation path.** Removing the live query path eliminates an entire class of inconsistency bugs. Every number on the Balance Sheet comes from a snapshot computed by the same code.

### 1.4 Non-Goals

- Intraday or real-time Balance Sheet updates (operates on daily snapshots).
- Changing the journal's deletion-based approach for untracked positions.
- Multi-currency support beyond USD (existing Phase 1 limitation, unchanged).
- P&L Statement changes (this PRD focuses on the Balance Sheet data pipeline; P&L consumes the same snapshots but its UI/API are not modified here).

---

## 2. System Context — What Exists Today

### 2.1 NAV Snapshot Generation (`NavSnapshotService`)

**File:** `packages/midcurve-services/src/services/nav-snapshot/nav-snapshot-service.ts`

The daily snapshot job (`DailyNavSnapshotRule`, cron `0 1 * * *` UTC) calls `NavSnapshotService.generateSnapshot()`, which runs three phases:

| Phase | What It Does | External Calls |
|-------|-------------|----------------|
| **A: Refresh positions** | For each active position: resolve midnight block (Etherscan), fetch pool sqrtPriceX96 + position liquidity (Subgraph), simulate `collect()` at midnight block (RPC), subtract uncollected principal (DB), compute `currentValue`/`unrealizedPnl`/`unClaimedFees`, update Position model, publish `position.state.refreshed` | Etherscan, The Graph, EVM RPC |
| **B: CoinGecko rates** | Fetch historical USD price per unique quote token at the snapshot date | CoinGecko API |
| **C: Persist snapshots** | Group positions by user, convert values to reporting currency, query journal balances per position (`getAccountBalanceReporting` × 11 accounts × N positions), upsert `NAVSnapshot` row per user | Database only |

### 2.2 Journal Balance Queries

Two methods in `JournalService` (`packages/midcurve-services/src/services/journal/journal-service.ts`):

| Method | Scope | Used By |
|--------|-------|---------|
| `getAccountBalanceReporting(accountCode, positionRef)` | Single position | Phase C of snapshot generation |
| `getUserAccountBalanceReporting(accountCode, userId)` | All user positions | Balance Sheet API endpoint (current column) |

Both return `debits - credits` as bigint in reporting currency. The asymmetry — snapshots use position-scoped queries while the Balance Sheet API uses user-scoped queries — is the root cause of Problem 1.

### 2.3 Position Deletion Flow

```
Position.delete() → Prisma cascade (ledger events, APR periods, orders, etc.)
                   → publishes position.deleted domain event

position.deleted event → PostJournalEntriesOnPositionEventsRule
                       → JournalService.untrackPosition(userId, positionRef)
                       → CASCADE: TrackedPosition → JournalEntry → JournalLine

NAVSnapshot: NOT touched — retains stale data from deleted position
```

### 2.4 Balance Sheet API Endpoint

**File:** `apps/midcurve-api/src/app/api/v1/accounting/balance-sheet/route.ts`

- **Current column:** 11 parallel calls to `getUserAccountBalanceReporting(accountCode, userId)` — live journal state
- **Previous column:** `navSnapshotService.getSnapshotAtBoundary(userId, previousEnd)` — reads pre-computed snapshot

These are two fundamentally different calculation paths, which is Problem 2.

### 2.5 NAVSnapshot Schema

**File:** `packages/midcurve-database/prisma/schema.prisma` (accounting schema)

```
NAVSnapshot
  @@unique([userId, snapshotDate, snapshotType])
  Fields: totalAssets, netAssetValue, depositedLiquidityAtCost, markToMarketAdjustment,
          unclaimedFees, contributedCapital, capitalReturned, retainedRealizedWithdrawals,
          retainedRealizedFees, retainedUnrealizedPrice, retainedUnrealizedFees,
          activePositionCount, positionBreakdown (Json)
```

All monetary values are bigint-as-string, scaled 10^8 in reporting currency. No retention or cleanup logic exists — snapshots accumulate indefinitely.

---

## 3. Snapshot Recomputation on Position Removal

### 3.1 Problem

When a position is deleted, its journal entries are correctly removed. But existing NAV snapshots still contain journal balance totals that included the deleted position. The snapshot's equity/retained-earnings fields are stale, while asset fields (computed from position data, which also no longer exists) are zero. This produces an unbalanced Balance Sheet.

### 3.2 Specification

When `position.deleted` is handled by the accounting rule:

1. **Delete journal entries** (existing behavior via `untrackPosition`).
2. **Identify affected snapshots.** Query all `NAVSnapshot` rows for the user that have a `journalHash` that no longer matches the current journal state.
3. **Recompute affected snapshots.** For each stale snapshot, recompute the journal-derived fields (all 11 account balances) from the current journal state. On-chain-derived fields (totalAssets, positionBreakdown) are recomputed from the cached on-chain state (see Section 5).
4. **Update the snapshot** in place (same row, same date).

### 3.3 Journal Hash

Each `NAVSnapshot` stores a `journalHash` — a deterministic hash over the journal entries that contributed to its computation.

**Computation:** Sort all `TrackedPosition.positionRef` values for the user alphabetically, concatenate them, and hash with SHA-256. This captures the set of tracked positions, which is the primary axis of change when positions are added or removed.

**Staleness detection:** After `untrackPosition()` completes, compute the new journal hash for the user. Query all snapshots where `journalHash != newHash`. These are stale and need recomputation.

**Why position set, not entry content:** Individual journal entries change on every M2M refresh. Hashing entry content would make every snapshot stale on every daily run. The position set changes only when positions are added or removed — exactly the events that create genuine staleness.

### 3.4 Recomputation Scope

Recomputation is bounded by the retention policy (Section 4). Maximum ~40 snapshots per user. Each recomputation:

- Reads 11 account balances from the journal (now user-scoped, not position-scoped — see Section 3.5)
- Reads cached on-chain state for position-derived values (totalAssets, positionBreakdown)
- Pure local computation — no RPC calls needed (on-chain state is cached per snapshot)

### 3.5 Switch to User-Scoped Journal Queries

The current snapshot generation uses `getAccountBalanceReporting(accountCode, positionRef)` per position, then sums. This must change to `getUserAccountBalanceReporting(accountCode, userId)` — a single query per account that aggregates across all positions.

**Why:** After a position is deleted, its journal entries are gone. The user-scoped query naturally excludes them. The position-scoped approach requires knowing which positions existed at snapshot time and iterating over them — which is the exact information that becomes stale.

This aligns snapshot generation with the Balance Sheet API's current column (which already uses user-scoped queries), closing the asymmetry that caused the original bug.

---

## 4. Snapshot Retention Policy

### 4.1 Retention Tiers

Snapshots are retained at decreasing granularity over time to bound storage growth.

| Tier | Granularity | Retention | Max Snapshots |
|------|-------------|-----------|---------------|
| Daily | 1 day | 14 days | 14 |
| Weekly | 1 week | 6 weeks | 6 |
| Monthly | 1 month | 13 months | 13 |
| Quarterly | 1 quarter | 5 quarters | 5 |
| Yearly | 1 year | Indefinite | Unbounded |

**Maximum snapshots per user:** ~38 + years of history. In practice, well under 50 at any point in time.

### 4.2 Roll-Up Strategy

When a daily snapshot ages out of the 14-day window, it is promoted to a weekly snapshot if it falls on the **end-of-week stichtag** (Sunday midnight UTC = Monday 00:00 UTC, representing Sunday end-of-day). Otherwise it is discarded.

The same end-of-period principle applies to all tier promotions:
- Weekly → Monthly: last Sunday snapshot of the month (closest to month-end)
- Monthly → Quarterly: last month-end snapshot of the quarter
- Quarterly → Yearly: last quarter-end snapshot of the year

This aligns with IFRS-style end-of-period valuation conventions.

### 4.3 Promotion Mechanics

When a snapshot is promoted, its `snapshotType` is updated from `daily` to `weekly`, `monthly`, `quarterly`, or `yearly`. The row is not duplicated — it is the same row with an updated type. The unique constraint `(userId, snapshotDate, snapshotType)` allows this because the type changes.

### 4.4 Retention Job

A new scheduled rule (`SnapshotRetentionRule`) runs daily after the snapshot generation job (e.g., cron `0 2 * * *` UTC). For each user:

1. Identify daily snapshots older than 14 days.
2. For each: promote if it's an end-of-period representative, or delete.
3. Repeat for weekly (>6 weeks), monthly (>13 months), quarterly (>5 quarters).

Deleting a snapshot cascade-deletes its on-chain state cache entries (Section 5).

---

## 5. On-Chain State Cache

### 5.1 Rationale

Snapshot recomputation (Section 3) must reproduce the same position-derived values (totalAssets, positionBreakdown) without hitting external APIs. On-chain state at a given block is immutable — it never changes retroactively. By caching this state per snapshot, recomputation becomes a pure local calculation.

### 5.2 What Is Cached

Each snapshot stores the on-chain data that was used during its computation:

| Data | Source | Per |
|------|--------|-----|
| Midnight block number | Etherscan | Chain |
| Pool sqrtPriceX96 | Subgraph / RPC | Pool |
| Position liquidity | Subgraph / RPC | Position |
| collect() result (tokensOwed0, tokensOwed1) | RPC staticcall | Position |
| Uncollected principal (principal0, principal1) | DB (PositionLedgerEvent) | Position |
| CoinGecko USD price | CoinGecko API | Quote token |

Additionally, the cache stores the static position/pool metadata needed for recomputation (tick range, token decimals, isToken0Quote, cost basis at snapshot time) so that recomputation is fully self-contained even if the position has since been deleted.

### 5.3 Data Model

```prisma
model SnapshotStateCache {
  id          String   @id @default(cuid())
  snapshotId  String
  snapshot    NAVSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)

  // Per-chain data
  chainId         Int
  midnightBlock   String  // bigint-as-string

  // Cached state per position (JSON array)
  // Each entry: { positionRef, poolAddress, sqrtPriceX96, liquidity,
  //               tokensOwed0, tokensOwed1, uncollectedPrincipal0, uncollectedPrincipal1,
  //               tickLower, tickUpper, token0Decimals, token1Decimals,
  //               isToken0Quote, currentCostBasis }
  positionStates  Json

  // CoinGecko USD prices at snapshot date (JSON object: { coingeckoId: usdPrice })
  quoteTokenPrices Json

  @@unique([snapshotId, chainId])
  @@index([snapshotId])
  @@map("snapshot_state_cache")
  @@schema("accounting")
}
```

**Ownership:** Each `SnapshotStateCache` row belongs to exactly one `NAVSnapshot`. The `onDelete: Cascade` ensures cache entries are deleted when their snapshot is deleted (either by retention pruning or user deletion).

**Granularity:** One cache row per snapshot per chain. A user with positions on two chains gets two cache rows per snapshot. The `positionStates` JSON array contains per-position data; `quoteTokenPrices` is shared across positions on that chain.

### 5.4 Cache Population

During snapshot generation (Phase A + B), after computing position values, the service writes a `SnapshotStateCache` row per chain with all intermediate values. This happens inside `persistSnapshots` (Phase C), alongside the `NAVSnapshot` upsert.

### 5.5 Cache-Based Recomputation

When a snapshot needs recomputation (Section 3):

1. Read the `SnapshotStateCache` rows for the snapshot.
2. Filter out positions that no longer exist in the journal (their `positionRef` is no longer tracked).
3. Recompute `totalAssets` and `positionBreakdown` from the cached on-chain state of the remaining positions.
4. Query journal balances (user-scoped) for the equity/retained-earnings fields.
5. Update the `NAVSnapshot` row and its `journalHash`.

No external API calls required.

### 5.6 No Independent Cache Retention

Cache entries have no independent retention policy. They live and die with their parent snapshot. When the retention job (Section 4.4) deletes a snapshot, Prisma's `onDelete: Cascade` removes the associated cache entries automatically.

---

## 6. Snapshot-Only Reporting

### 6.1 Rationale

Currently, the Balance Sheet's current column runs 11 live journal queries, while the previous column reads from a snapshot. This mixes two different calculation paths — different price sources, different aggregation scope (user-level vs. position-level), and potential race conditions where the journal state changes between the 11 parallel queries. Switching entirely to snapshot-based reporting eliminates this inconsistency.

### 6.2 Specification

All reporting endpoints (Balance Sheet, P&L) read exclusively from `NAVSnapshot` rows. The current column uses today's snapshot (most recent daily snapshot). The previous column uses the snapshot at the period boundary, identical to today's behavior.

**Comparison periods:**

| Report Period | Current Value | Comparison Value |
|---------------|---------------|-----------------|
| Daily | Today 00:00 UTC snapshot | Yesterday 00:00 UTC snapshot |
| Weekly | Today 00:00 UTC snapshot | Last Monday 00:00 UTC snapshot |
| Monthly | Today 00:00 UTC snapshot | 1st of current month 00:00 UTC |
| Quarterly | Today 00:00 UTC snapshot | 1st of current quarter 00:00 UTC |
| Yearly | Today 00:00 UTC snapshot | January 1st 00:00 UTC |

### 6.3 Balance Sheet API Changes

**File:** `apps/midcurve-api/src/app/api/v1/accounting/balance-sheet/route.ts`

The endpoint changes from:
```
Current: 11 × getUserAccountBalanceReporting() (live)
Previous: getSnapshotAtBoundary()
```

To:
```
Current: getLatestSnapshot(userId)
Previous: getSnapshotAtBoundary(userId, previousEnd)
```

Both columns read the same `NAVSnapshot` fields. The sign adjustments, computed aggregates (`totalRetainedEarnings`, `totalEquity`), and `buildLineItem` logic remain unchanged — they just operate on two snapshot rows instead of one snapshot + live journal.

### 6.4 New User Experience

If no snapshot exists yet (user just onboarded), the Balance Sheet displays:

> **"Reporting data will be available after the next daily snapshot at 01:00 UTC."**

To minimize the cold-start gap, an **initial snapshot** is created during position tracking (the first `position.created` event that creates a `TrackedPosition`). This captures the starting state and ensures the user has data immediately, even if the values are trivially zero or reflect only the initial deposit.

### 6.5 Data Freshness

Snapshots are computed at 01:00 UTC daily with midnight UTC as the valuation timestamp. The Balance Sheet reflects the state as of the most recent midnight UTC, not real-time. This is consistent with the existing behavior (snapshots were already used for the previous column) and aligns with standard financial reporting conventions.

For users who want to see intraday changes, the existing position-level dashboard (individual position cards with live values) continues to operate independently of the snapshot system.

---

## 7. Implementation Sequence

The four changes have dependencies and should be implemented in order:

### Phase 1: User-Scoped Journal Queries + Journal Hash

**Files:**
- `packages/midcurve-services/src/services/nav-snapshot/nav-snapshot-service.ts`
- `packages/midcurve-database/prisma/schema.prisma`

1. Add `journalHash` column to `NAVSnapshot`.
2. Replace `getUserAccountBalances(positions)` (position-scoped iteration) with user-scoped `getUserAccountBalanceReporting` calls.
3. Compute and store `journalHash` during snapshot creation.
4. Migration to add column + backfill existing snapshots with current hash.

### Phase 2: On-Chain State Cache

**Files:**
- `packages/midcurve-database/prisma/schema.prisma`
- `packages/midcurve-services/src/services/nav-snapshot/nav-snapshot-service.ts`

1. Add `SnapshotStateCache` model.
2. Write cache entries during snapshot generation (Phase A/B results).
3. Add `recomputeSnapshot(snapshotId)` method that reads cache and recomputes.

### Phase 3: Snapshot Recomputation on Position Removal

**Files:**
- `apps/midcurve-business-logic/src/rules/accounting/post-journal-entries-on-position-events.ts`
- `packages/midcurve-services/src/services/nav-snapshot/nav-snapshot-service.ts`

1. After `untrackPosition()`, compute new journal hash.
2. Query stale snapshots (where `journalHash != newHash`).
3. Recompute each using `recomputeSnapshot()`.
4. Update journal hash on recomputed snapshots.

### Phase 4: Snapshot Retention Policy

**Files:**
- `apps/midcurve-business-logic/src/rules/accounting/` (new `snapshot-retention.ts`)
- `packages/midcurve-services/src/services/nav-snapshot/nav-snapshot-service.ts`

1. Add `snapshotTier` field or update `snapshotType` semantics.
2. Implement retention rule with promotion/deletion logic.
3. Schedule after daily snapshot job.

### Phase 5: Snapshot-Only Reporting

**Files:**
- `apps/midcurve-api/src/app/api/v1/accounting/balance-sheet/route.ts`
- `apps/midcurve-api/src/app/api/v1/accounting/pnl/route.ts`

1. Replace live journal queries with snapshot reads in Balance Sheet endpoint.
2. Add cold-start handling (no snapshot yet → informational message).
3. Add initial snapshot creation on first position tracking.
4. Remove unused `getUserAccountBalanceReporting` calls from API layer.

---

## 8. Migration Strategy

### 8.1 Database Migrations

1. Add `journalHash` column to `NAVSnapshot` (NOT NULL).
2. Create `SnapshotStateCache` table in `accounting` schema.
3. Update `snapshotType` to support retention tier values (`daily`, `weekly`, `monthly`, `quarterly`, `yearly`).

### 8.2 Existing Data

Only development data exists. All existing `NAVSnapshot` rows are deleted as part of the migration. New snapshots with proper `journalHash` and `SnapshotStateCache` entries are generated from scratch on the next daily cron run (or manual trigger).

---

## 9. Verification

### 9.1 Unit Tests

- Journal hash computation produces the same hash for the same set of tracked positions regardless of order.
- `recomputeSnapshot` produces the same `NAVSnapshot` field values as the original generation when no positions have been removed.
- `recomputeSnapshot` correctly zeroes out all fields when all positions have been removed.
- Retention rule correctly promotes/discards snapshots according to the tier table.

### 9.2 Integration Tests

- End-to-end: create position → generate snapshot → delete position → verify snapshot is recomputed with zeroed values.
- End-to-end: generate 20 daily snapshots → run retention → verify correct number remain.
- Balance Sheet API: both columns read from snapshots, values match.

### 9.3 Manual Verification

- Deploy to staging. Create a position, wait for daily snapshot (or trigger manually). Delete the position. Verify the Balance Sheet's Previous column shows $0 for both assets and equity.
- Verify cold-start: new user with no snapshots sees informational message, not broken data.
