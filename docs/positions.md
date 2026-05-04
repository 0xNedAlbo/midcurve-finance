# Midcurve Finance - Positions

Positions are the central object in Midcurve. They represent an on-chain liquidity-providing exposure that the platform tracks, accounts for, and (optionally) automates. This document describes the supported position types, their PnL mechanics, the actions a user can take, and the metric surface exposed to clients.

For the philosophy that drives the metric framework — quote/base paradigm, risk definition, and rejection of "impermanent loss" — see [philosophy.md](./philosophy.md). This document is the structural counterpart: what a position *is*, not why we measure it the way we do.

---

## Supported Position Types

A position is identified by two discriminators on the `Position` model:

| Field | Purpose |
|---|---|
| `protocol` | The on-chain protocol implementation (`uniswapv3`, `uniswapv3-vault`) |
| `type` | The DeFi position category (`LP_CONCENTRATED`, `VAULT_SHARES`) |

Identity is materialised as `positionHash` — a slash-separated, human-readable composite key (per [`.claude/rules/platform-agnostic-design.md`](../.claude/rules/platform-agnostic-design.md)):

- UniswapV3 NFT: `uniswapv3/{chainId}/{nftId}`
- UniswapV3 vault share: `uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}`

Today there are two position families:

### 1. UniswapV3 NFT Position (`protocol: 'uniswapv3'`, `type: 'LP_CONCENTRATED'`)

A direct concentrated-liquidity NFT minted on the Uniswap V3 NonfungiblePositionManager (NFPM). The user owns the NFT in their wallet; Midcurve tracks it read-only and (when the user opts in) registers a close order on a deployed `UniswapV3PositionCloser` Diamond proxy.

**Idea & purpose.** The canonical Uniswap V3 LP experience: pick a tick range, deposit token0/token1, earn swap fees while the price is inside the range. Midcurve adds the missing risk-management layer — quote-token PnL accounting, APR tracking per fee-collection period, range-exit notifications, and conditional close orders. The NFT stays in the user's wallet; the protocol contract only acts via the operator approval the user grants.

**Identity.**
- `chainId` + `nftId` (the NFPM token ID) uniquely identify the position on-chain.
- The same `nftId` can be tracked by multiple users (read-only watching), enforced by `@@unique([userId, positionHash, ownerWallet])` on the `Position` model.

### 2. UniswapV3 Vault Share Position (`protocol: 'uniswapv3-vault'`, `type: 'VAULT_SHARES'`)

An ERC-20-like share in an `AllowlistedUniswapV3Vault` (a clone deployed by `UniswapV3VaultFactory`). The vault owns a single underlying Uniswap V3 NFT; users own shares of that NFT. Multiple users can co-invest in one vault, with pro-rata yield accrual and a vault-specific position closer (`UniswapV3VaultPositionCloser` Diamond).

**Idea & purpose.** Pool capital from several depositors into a single concentrated position so that fixed costs (gas for collect/rebalance, monitoring) are shared, and so that one user can act as the "operator" of a curated strategy on behalf of allowlisted depositors. Each user still has an individual position in Midcurve — separate cost basis, PnL, and yield — derived from `(sharesBalance, totalSupply, vaultLiquidity)` snapshots.

**Identity.**
- Composite: `(chainId, vaultAddress, ownerAddress)` — one row per (vault, share-holding wallet).
- The same vault is held by multiple users; each gets their own `Position` row keyed by `ownerAddress`.

### Future protocols

`PositionProtocol` is a string discriminator and the codebase assumes more protocols will land — Hyperliquid (perpetuals), Aave-style lending, Solana CLMMs (Orca, Raydium), etc. The `Position` model carries protocol-agnostic financial fields plus protocol-specific `config` (immutable) and `state` (mutable) JSON columns; new protocols add a discriminator value and their own typed config/state without touching existing types. See [philosophy.md](./philosophy.md) and the multi-platform rules for the abstraction strategy.

---

## General PnL Mechanics

All financial values are stored and computed in **quote-token units** as `bigint`. Display formatting is the very last step (per [`.claude/rules/bigint-precision.md`](../.claude/rules/bigint-precision.md)). The user picks which side of the pair is the quote token at import time via `isToken0Quote`, and can flip it later via `POST /positions/.../switch-quote-token` — every metric below is recomputed in the new numeraire.

### The four PnL components

A position's lifetime profit/loss decomposes into four parts. The `Position` row stores three pre-computed cumulatives plus one derived value:

| Component | Stored field | Source of truth |
|---|---|---|
| **Realized PnL** | `realizedPnl` | Withdrawn principal vs. its proportional cost basis (`DECREASE_POSITION` events) |
| **Realized cashflow** | `realizedCashflow` | Locked-in periodic income (funding for perps, interest for lending). `0` for AMM LPs. |
| **Collected yield** | `collectedYield` | Sum of `COLLECT` event token values, valued at the price at collection time |
| **Unrealized PnL** | `unrealizedPnl` (= `currentValue − costBasis`) | Live computation from on-chain state |
| **Unclaimed yield** | `unclaimedYield` | Live computation from on-chain fee state |
| **Unrealized cashflow** | `unrealizedCashflow` | Pending funding/interest. `0` for AMM LPs. |

**Helpers on the domain class** (`BasePosition` in `@midcurve/shared`):
- `getTotalRealizedPnl() = realizedPnl + realizedCashflow`
- `getTotalUnrealizedPnl() = unrealizedPnl + unrealizedCashflow`

**Full lifetime PnL summary** (from `UniswapV3PositionPnLSummary` returned by `fetchPnLSummary`):

```
realizedSubtotal   = collectedYield + realizedPnl
unrealizedSubtotal = unclaimedYield + currentValue − costBasis
totalPnl           = realizedSubtotal + unrealizedSubtotal
```

### Cost basis and the ledger

Cost basis is **never** computed from the user's deposits in fiat — it is accumulated event-by-event from the `PositionLedgerEvent` chain in quote-token units. Every event records both a delta and a running cumulative:

| Event field | Meaning |
|---|---|
| `deltaCostBasis` / `costBasisAfter` | Change and running total of cost basis |
| `deltaPnl` / `pnlAfter` | Change and running total of realized PnL |
| `deltaCollectedYield` / `collectedYieldAfter` | Change and running total of collected yield |
| `deltaRealizedCashflow` / `realizedCashflowAfter` | Change and running total of realized cashflow |
| `tokenValue` | Net value moved by this event in quote tokens |
| `rewards` | Reward-token array (`{tokenId, tokenAmount, tokenValue}`) for vault yields, etc. |
| `previousId` | Doubly-linked event chain — events are processed in causal order |
| `isIgnored` / `ignoredReason` | Events that occurred outside the user's wallet ownership are ignored for financials (e.g. when an NFT was transferred away and back) |

The chain is the single source of truth: rebuilding the Position row from an empty start by replaying the chain must reproduce the cumulative fields. This invariant is what `POST /positions/.../reload-history` and the `UniswapV3ReconcileCostBasisRule` verify.

### Event taxonomy

Per `EventType` in `@midcurve/shared`:

**UniswapV3 NFT positions:**
- `INCREASE_POSITION` — capital deployed (deposit / mint)
- `DECREASE_POSITION` — capital withdrawn (partial close / burn)
- `COLLECT` — fees withdrawn from the position
- `MINT` / `BURN` / `TRANSFER` — lifecycle events with `deltaLiquidity = 0`

**Vault positions** (mirror the NFT events, plus dedicated vault transitions):
- `VAULT_MINT` / `VAULT_BURN` — share supply changes (deposit / withdraw)
- `VAULT_COLLECT_YIELD` — claimable yield distributed to shareholders
- `VAULT_TRANSFER_IN` / `VAULT_TRANSFER_OUT` — share transfers between wallets
- `VAULT_CLOSE_ORDER_EXECUTED` — vault-position closer fired

### APR computation

APR is **not** a single number — it is a sequence of per-period APR rates. The `PositionAprPeriod` model stores one row per "yield-collection period":

```
PositionAprPeriod {
  startEventId, endEventId            // bracketed by ledger events
  startTimestamp, endTimestamp, durationSeconds
  costBasis             // average cost basis during the period
  collectedYieldValue   // total yield in quote tokens
  aprBps                // basis points, e.g. 2500 = 25.00%
  eventCount
}
```

The aggregate `Position.baseApr` / `rewardApr` / `totalApr` (Float, basis-point precision) is a time-weighted summary across the periods. The MCP server's `get_position_apr` tool returns both the per-period breakdown and the time-weighted summary.

### Cashflow valuation

Per [philosophy.md](./philosophy.md#cash-flow-measurement): yields and rewards are converted to quote-token value **at the time of collection**, not retroactively. Once recorded in `collectedYield`, the value is locked — later price moves don't restate it. This is the basis for both APR computation and the realized-PnL subtotal.

---

## Manual Actions

User-driven operations are exposed under `/api/v1/positions/...` and are uniform across position types except for protocol-specific identity in the URL. The list below is grouped by intent. Substitute either:

- `uniswapv3/[chainId]/[nftId]` for NFT positions
- `uniswapv3-vault/[chainId]/[vaultAddress]/[ownerAddress]` for vault-share positions

### Discovery & lifecycle

| Action | Endpoint | Notes |
|---|---|---|
| Discover wallet positions | `POST /positions/discover` (NFT)<br>`POST /positions/uniswapv3-vault/discover` | Scans the user's `UserWallet` rows for ownable positions on supported chains |
| Import an NFT position | `POST /positions/uniswapv3/import` | Adds a known `nftId` to the user's tracked set |
| View position detail | `GET /positions/<protocol>/<id>` | Returns the full `PositionJSON` |
| Refresh on-chain state | `POST /positions/<protocol>/<id>/refresh` | Re-reads `state` from chain; does not re-import ledger events |
| Reload full history | `POST /positions/<protocol>/<id>/reload-history` | Reimports all ledger events from chain & subgraph; rebuilds cumulatives from scratch |
| Switch quote token | `POST /positions/<protocol>/<id>/switch-quote-token` | Flips `isToken0Quote`; recomputes every quote-denominated field |
| Archive | `POST /positions/archive` | Soft-deletes (sets `isArchived`); position can be unarchived. Closed positions are not auto-archived |
| Refresh all | `POST /positions/refresh-all` | Bulk refresh used by the dashboard |
| List | `GET /positions/list` | Paginated list with metric fields |

### Inspection & analytics

| Action | Endpoint | Returns |
|---|---|---|
| Ledger | `GET /positions/<protocol>/<id>/ledger` | Paginated `PositionLedgerEventJSON[]` |
| APR | `GET /positions/<protocol>/<id>/apr` | Per-period APR + time-weighted summary |
| Accounting | `GET /positions/<protocol>/<id>/accounting` | Journal entries (double-entry), realized P&L breakdown, audit trail |
| Conversion | `GET /positions/<protocol>/<id>/conversion` (NFT only) | Net deposits/withdrawals/holdings, rebalancing direction, fee premium |
| Single-price simulation | `POST /positions/<protocol>/<id>/simulate` | `PnLSimulationResult` at a hypothetical price |
| PnL curve | `GET /positions/<protocol>/<id>/pnl-curve` | List of `(price, value, pnl, pnlPercent, phase)` across a price range |

### Close orders (per-position automation registration)

| Action | Endpoint |
|---|---|
| List close orders | `GET /positions/<protocol>/<id>/close-orders` |
| Get / update / delete | `*/close-orders/[closeOrderHash]` |
| Update automation state | `PATCH */close-orders/[closeOrderHash]/automation-state` (vault path) |
| Available shared contracts | `GET /positions/uniswapv3/[chainId]/[nftId]/close-orders/shared-contracts`<br>`GET /automation/shared-contracts/[chainId]` |
| Automation logs | `GET /automation/logs` |

The on-chain registration transaction is built by the API but signed by the user's wallet — Midcurve never holds user keys. After registration, the order is mirrored in the `CloseOrder` table and picked up by the automation worker.

---

## Automated Actions

Automation is opt-in. Each automated behaviour is driven by domain events flowing through RabbitMQ exchanges; nothing polls on a timer (per [`.claude/rules/automation-workers.md`](../.claude/rules/automation-workers.md)). The on-chain pieces are the position-closer Diamond contracts; the off-chain pieces live in `apps/midcurve-automation/` and `apps/midcurve-business-logic/`.

### Range monitoring & notifications

A `PositionRangeStatus` row (1:1 with `Position`) tracks `isInRange`. When the on-chain price crosses a tick boundary of the position, the onchain-data layer emits a pool-price event; the range monitor recomputes `isInRange`, persists the new value, and — on a transition — emits a `UserNotification` (and a webhook hit if configured via `UserWebhookConfig`).

### Close orders (Stop-In-Loss / Take-In-Profit)

Both NFT positions and vault positions support price-triggered close orders, registered on the appropriate Diamond proxy:

- **NFT:** `UniswapV3PositionCloser` (Diamond) — `RegistrationFacet` registers, `ExecutionFacet` executes
- **Vault:** `UniswapV3VaultPositionCloser` (Diamond, separate facet set) — same shape, vault-aware

A close order is described by a `TriggerMode` and an optional post-close swap:

| Field | Values | Meaning |
|---|---|---|
| `triggerMode` | `LOWER` (Stop-In-Loss) · `UPPER` (Take-In-Profit) | Direction the price must cross to fire |
| `triggerTick` | `int24` | Tick threshold (translates to a price boundary) |
| `slippageBps` | `0–10000` | Slippage tolerance for the close itself |
| `swapConfig.enabled` | `bool` | Whether to swap proceeds after close |
| `swapConfig.direction` | `TOKEN0_TO_1` · `TOKEN1_TO_0` | Pool-native direction (role-agnostic) |
| `swapConfig.slippageBps` | `0–10000` | Slippage tolerance for the swap leg |
| `payoutAddress` | EVM address | Where the post-close (and post-swap) tokens are sent |
| `validUntil` | timestamp | Order expiry |

**Automation lifecycle** (single `automationState` field on `CloseOrder`):

```
inactive → monitoring → executing → ┬─→ executed   (success, terminal)
                              │     ├─→ retrying → monitoring  (transient failure)
                              │     └─→ failed     (max attempts, terminal)
```

- `MAX_EXECUTION_ATTEMPTS = 3`, retries delayed via a 60-second TTL queue.
- `executionAttempts` resets when the price moves back away from the trigger.
- `lastError` captures the last execution error for diagnostics; full history is in `AutomationLog`.

**On-chain execution** (`ExecutionFacet`):
1. Decreases liquidity to zero (or to the requested fraction for vault flash-close).
2. Collects all owed fees.
3. Optionally calls `MidcurveSwapRouter.sell(...)` with a single-hop UniswapV3 path (`venueId = keccak256("UniswapV3")`, `venueData = abi.encode(uint24 fee)`).
4. Forwards the resulting tokens to `payoutAddress`.

The whole flow is one transaction. Slippage protection comes from the user-supplied `minAmountOut` derived from `slippageBps` plus current pool price (computed by `calculatePoolSwapMinAmountOut` in the executor).

### Operator gas top-up

The automation EOA (the wallet that submits close-order transactions) is kept funded across all chains by the `RefuelOperatorRule` in business-logic, which draws from the gas escrow contract. Without this rule, automation can't execute; with it, the user only deposits gas once per chain and forgets about it.

### Accounting pipeline

Every ledger event posted to a position (manual or automated) flows into the journal-entry pipeline run by business-logic:

- `UniswapV3PostJournalEntriesRule` — writes double-entry `JournalEntry` / `JournalLine` rows for every NFT-position event.
- `UniswapV3VaultPostJournalEntriesRule` — vault variant.
- `UniswapV3ReconcileCostBasisRule` — periodic reconciliation against on-chain truth.
- `UniswapV3ReevaluateOnWalletChangeRule` — re-evaluates ownership when a user adds/removes a wallet.

The `/positions/.../accounting` endpoint exposes the resulting journal in the user's reporting currency.

---

## Common Metric Fields

These fields appear on **every** position regardless of protocol. They are defined on `BasePosition` in `@midcurve/shared` and on the `Position` model in `@midcurve/database`. Wire format is `PositionJSON` (bigints serialised as strings, `Date` as ISO strings).

### Identity

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (cuid) | Database primary key |
| `positionHash` | `string` | Human-readable composite key, see [Supported Position Types](#supported-position-types) |
| `userId` | `string` | Owner of the tracking record (not the on-chain owner) |
| `ownerWallet` | `"{platform}:{address}"` | On-chain owner wallet, e.g. `"evm:0x1234..."` |
| `protocol` | `'uniswapv3' \| 'uniswapv3-vault'` | Discriminator for `config` / `state` shape |
| `type` | `'LP_CONCENTRATED' \| 'VAULT_SHARES'` | Position category |

### Value & PnL (all `bigint` in quote-token units)

| Field | Meaning |
|---|---|
| `currentValue` | Live position value, derived from on-chain state |
| `costBasis` | Cumulative quote-token value of capital currently deployed |
| `realizedPnl` | Locked-in PnL from withdrawn principal |
| `unrealizedPnl` | `currentValue − costBasis` (computed; not stored as a separate cumulative) |
| `realizedCashflow` | Locked-in periodic income (perps, lending). `0` for AMM LPs. |
| `unrealizedCashflow` | Pending periodic income. `0` for AMM LPs. |

### Yield (all `bigint` in quote-token units)

| Field | Meaning |
|---|---|
| `collectedYield` | Cumulative fees/rewards collected, valued at collection time |
| `unclaimedYield` | Live fees/rewards accrued but not yet collected |
| `lastYieldClaimedAt` | Timestamp of the most recent collection event |

### APR (`Float | null`, basis-point precision)

| Field | Meaning |
|---|---|
| `baseApr` | Time-weighted APR from base yield (swap fees / vault yield). `null` when below the noise threshold. |
| `rewardApr` | APR from external incentives (reward-token programmes). `null` if not applicable. |
| `totalApr` | `baseApr + rewardApr` (`null` propagates). |

### Lifecycle

| Field | Meaning |
|---|---|
| `positionOpenedAt` | First ledger event timestamp |
| `archivedAt` | When the user soft-deleted the position |
| `isArchived` | Soft-delete flag |
| `createdAt` / `updatedAt` | Database timestamps |

### Range (in JSON output)

`priceRangeLower` / `priceRangeUpper` (bigint in quote-token units) come out of the protocol-specific config (computed from ticks for UniswapV3) and are surfaced uniformly on `PositionJSON`.

---

## Type-Specific Metrics

The protocol-specific metrics live in the `config` (immutable) and `state` (mutable) JSON columns. Their typed shape is in `@midcurve/shared/src/types/position/{protocol}/`.

### UniswapV3 NFT (`LP_CONCENTRATED`)

**Config** — `UniswapV3PositionConfig` (immutable for the life of the NFT):

| Field | Type | Notes |
|---|---|---|
| `chainId` | `number` | 1, 42161, 8453 |
| `nftId` | `number` | NFPM token ID |
| `poolAddress` | `string` | EIP-55 pool address |
| `token0Address` / `token1Address` | `string` | Lexicographic order: `token0 < token1` |
| `feeBps` | `number` | `100`, `500`, `3000`, `10000` |
| `tickSpacing` | `number` | Derived from fee tier |
| `tickLower` / `tickUpper` | `number` | Position range in ticks |
| `isToken0Quote` | `boolean` | User-defined quote/base assignment |
| `priceRangeLower` / `priceRangeUpper` | `bigint` | Tick bounds projected into quote-token price space |

**State** — `UniswapV3PositionState` (refreshed on every read):

| Field | Type | Source |
|---|---|---|
| `ownerAddress` / `operator` | `string` | `NFPM.positions(nftId)` + ERC-721 ownership |
| `liquidity` | `bigint` | Position liquidity L |
| `feeGrowthInside0LastX128` / `1` | `bigint` | Fee-growth checkpoints (Q128.128) |
| `tokensOwed0` / `tokensOwed1` | `bigint` | Owed-fee snapshot from the position struct |
| `unclaimedFees0` / `unclaimedFees1` | `bigint` | Computed live fees (more accurate than `tokensOwed`) |
| `tickLowerFeeGrowthOutside0X128` … `tickUpperFeeGrowthOutside1X128` | `bigint` | Tick-level fee-growth ledger entries |
| `isBurned` | `boolean` | NFT no longer exists on-chain — read failures expected |
| `isClosed` | `boolean` | `liquidity == 0 && tokensOwed0 == 0 && tokensOwed1 == 0` |
| `isOwnedByUser` | `boolean` | On-chain owner matches one of the user's `UserWallet` rows |
| Pool-level: `sqrtPriceX96`, `currentTick`, `poolLiquidity`, `feeGrowthGlobal0`, `feeGrowthGlobal1` | various | Merged from `pool.slot0()` and `pool.feeGrowthGlobal*X128()` during refresh |

**Computed metrics** — `UniswapV3PositionMetrics` (from `fetchMetrics`):

`currentValue`, `costBasis`, `realizedPnl`, `unrealizedPnl`, `collectedYield`, `unclaimedYield`, `lastYieldClaimedAt`, `priceRangeLower`, `priceRangeUpper`, `isOwnedByUser`. The `PositionRangeStatus` 1:1 row adds `isInRange` and protocol-specific tracking data (`lastSqrtPriceX96`, `lastTick`).

**PnL summary** — `UniswapV3PositionPnLSummary` (from `fetchPnLSummary`):

```
realizedSubtotal   = collectedYield + realizedPnl
unrealizedSubtotal = unclaimedYield + currentValue − costBasis
totalPnl           = realizedSubtotal + unrealizedSubtotal
```

### UniswapV3 Vault Share (`VAULT_SHARES`)

**Config** — `UniswapV3VaultPositionConfig` (vault-level + pool-level identity):

| Field | Type | Notes |
|---|---|---|
| `chainId` | `number` | |
| `vaultAddress` | `string` | `AllowlistedUniswapV3Vault` clone address |
| `factoryAddress` | `string` | `UniswapV3VaultFactory` |
| `underlyingTokenId` | `number` | The single Uniswap V3 NFT held by the vault |
| `ownerAddress` | `string` | The user's wallet that holds shares |
| `vaultDecimals` | `number` | ERC-20 decimals of the vault share |
| `poolAddress` / `token0Address` / `token1Address` / `feeBps` / `tickSpacing` | | Same shape as NFT config |
| `tickLower` / `tickUpper` / `isToken0Quote` / `priceRangeLower` / `priceRangeUpper` | | Same shape as NFT config |

**State** — `UniswapV3VaultPositionState`:

| Field | Type | Notes |
|---|---|---|
| `sharesBalance` | `bigint` | User's vault-share token balance |
| `totalSupply` | `bigint` | Vault's total share supply |
| `liquidity` | `bigint` | Vault-level liquidity in the underlying NFT (the user's effective liquidity is `liquidity * sharesBalance / totalSupply`) |
| `unclaimedFees0` / `unclaimedFees1` | `bigint` | From `vault.claimableYield(user)` — combines pending + accumulator delta + tokensOwed (pro-rata) + unsnapshotted pool fees (pro-rata) |
| `operatorAddress` | `string` | Vault operator (authorized for `tend` / `setOperator`) |
| `isClosed` | `boolean` | `sharesBalance == 0` (reopenable — vault positions are not destroyed when shares hit zero) |
| `isOwnedByUser` | `boolean` | Same semantics as NFT |
| Pool-level: `sqrtPriceX96`, `currentTick`, `poolLiquidity`, `feeGrowthGlobal0`, `feeGrowthGlobal1` | various | Merged from pool during refresh |

**Differences from NFT state worth knowing:**
- **No `isBurned`.** Vault positions are always reopenable: a closed share position simply has `sharesBalance == 0` and can be reopened by receiving shares from another transfer.
- **No fee accumulator internals** (`feeGrowthInsideXLastX128`, `tokensOwedX`, tick-level fee-growth fields). The vault contract's `claimableYield(user)` collapses the entire 4-component picture into the two `unclaimedFees{0,1}` numbers.
- **User liquidity is derived, not stored.** The user's share of the vault's liquidity is computed at read time as `liquidity * sharesBalance / totalSupply`.
- **VAULT_*** ledger event types are emitted instead of the bare LP events (see [Event taxonomy](#event-taxonomy)).

### Common to both: `PositionRangeStatus`

Both protocols write to the same `PositionRangeStatus` row when the underlying pool's tick crosses a position boundary. The `data` JSON field is protocol-specific (currently `{ lastSqrtPriceX96, lastTick }` for UniswapV3). The `isInRange` flag is what drives in-range / below-range / above-range UI badges and notifications.

---

## See also

- [philosophy.md](./philosophy.md) — Quote/base paradigm, risk definition, why we abandoned IL
- [architecture.md](./architecture.md) — System architecture, packages, services, deployment
- [`packages/midcurve-shared/src/types/position/`](../packages/midcurve-shared/src/types/position/) — Authoritative position type definitions
- [`packages/midcurve-database/prisma/schema.prisma`](../packages/midcurve-database/prisma/schema.prisma) — Position, ledger event, APR period, range status, close order models
- [`apps/midcurve-mcp-server/README.md`](../apps/midcurve-mcp-server/README.md) — Read-only API surface for Claude clients (16 tools, several position-specific)
- [`.claude/rules/bigint-precision.md`](../.claude/rules/bigint-precision.md) — Why every monetary value is a bigint
- [`.claude/rules/platform-agnostic-design.md`](../.claude/rules/platform-agnostic-design.md) — How protocol-specific data is split between `config` and `state`
